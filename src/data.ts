/*
Build the emoji data files from emojibase plus the indexed image sources.
*/

import fs from 'node:fs/promises';

import type { Allow } from './allow.ts';
import {
	IMAGE_SIZE, REGIONAL_INDICATOR_GROUP, REGIONAL_INDICATOR_ORDER, REGIONAL_INDICATOR_START,
	SHEET_KERNEL, SHEET_PADDING, SHEET_SIZES, STYLES, type ImageSetId, type StyleId,
} from './config.ts';
import type { Emojibase, EmojibaseEmoji } from './emojibase.ts';
import { Findings } from './findings.ts';
import { fromCodes, type CompactData, type CompactEmoji, type CompactVersion, type Pos } from './format.ts';
import { canonicalFromHex, outputKey, parseCodepoints } from './keys.ts';
import type { Shipped } from './shipped.ts';
import { assignShortcodes, type ShortcodeTarget } from './shortcodes.ts';
import type { SourceIndex } from './sources.ts';
import { pool, sha256 } from './util.ts';

/** style => key => first 16 hex digits of the source PNG's sha256. Lets a diff show which images changed upstream. */
export type Manifest = Record<StyleId, Record<string, string>>;

export interface VerboseVersion {
	key: string;
	pos: Pos;
	images: number;
	tone: number | number[];
	codes: string[];
	type: 0 | 1;
}

export interface VerboseEmoji {
	key: string;
	group: number;
	order: number;
	name: string;
	codes: string[];
	type: 0 | 1;
	pos: Pos;
	images: number;
	versions: VerboseVersion[] | null;
}

export interface VerboseData {
	v: 3;
	emojibase: string;
	notos: number;
	blobs: number;
	twemojis: number;
	openmojis: number;
	noto3ds: number;
	grid: [number, number];
	sheets: string;
	categories: Record<string, string>;
	emoji: VerboseEmoji[];
}

export interface BuildResult {
	compact: CompactData;
	verbose: VerboseData;
	manifest: Manifest;
}

/** Grid for `count` cells: as square as possible. */
export function gridFor(count: number): [number, number] {
	const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
	return [cols, Math.ceil(count / cols)];
}

function applyOverrides(data: readonly EmojibaseEmoji[], findings: Findings): EmojibaseEmoji[] {
	const out: EmojibaseEmoji[] = [];
	const ungrouped: string[] = [];
	for (const emoji of data) {
		if (emoji.group !== undefined && emoji.order !== undefined) {
			out.push(emoji);
			continue;
		}
		const cps = parseCodepoints(emoji.hexcode);
		const offset = cps.length === 1 ? cps[0]! - REGIONAL_INDICATOR_START : -1;
		if (offset >= 0 && offset < 26) {
			out.push({ ...emoji, group: REGIONAL_INDICATOR_GROUP, order: REGIONAL_INDICATOR_ORDER + offset });
			continue;
		}
		ungrouped.push(emoji.hexcode);
	}
	if (ungrouped.length)
		findings.error('input-ungrouped', `${ungrouped.length} emoji have no group or order in emojibase, and we don't know where to put them.`, ungrouped);

	// Stable sort by order. Emojibase is already sorted; this moves the regional indicators to the end like 2020.
	return out.map((e, i) => [e, i] as const)
		.sort((a, b) => a[0].order! - b[0].order! || a[1] - b[1])
		.map(x => x[0]);
}

/** `previous` is what had shipped (shipped.json): its shortcodes are kept. */
export async function buildData(eb: Emojibase, indexes: Record<ImageSetId, SourceIndex>, previous: Shipped | null, allow: Allow, findings: Findings): Promise<BuildResult> {
	const data = applyOverrides(eb.data, findings);

	// Unique keys, also after FE0F folding (that's how image files are matched).
	const seen = new Map<string, string>();
	const dupes: string[] = [];
	for (const emoji of data)
		for (const hex of [emoji.hexcode, ...(emoji.skins ?? []).map(s => s.hexcode)]) {
			const canon = canonicalFromHex(hex);
			const other = seen.get(canon);
			if (other)
				dupes.push(`${hex} = ${other}`);
			seen.set(canon, hex);
		}
	if (dupes.length)
		findings.error('duplicate-key', `${dupes.length} emoji share a key (ignoring FE0F). Image matching would be ambiguous.`, dupes);

	// Shortcodes.
	const targets: ShortcodeTarget[] = [];
	for (const emoji of data) {
		targets.push({ key: outputKey(emoji.hexcode), hexcode: emoji.hexcode, label: emoji.label });
		for (const skin of emoji.skins ?? [])
			targets.push({ key: outputKey(skin.hexcode), hexcode: skin.hexcode, label: skin.label });
	}
	const prevCodes = new Map<string, string[]>();
	if (previous)
		for (const [key, entry] of previous)
			prevCodes.set(key, entry.codes);
	const codes = assignShortcodes(targets, eb.shortcodes, prevCodes, new Set(Object.keys(allow.dropShortcodes)), findings);

	// Images.
	const manifest = Object.fromEntries(STYLES.map(s => [s.id, {}])) as Manifest;
	const hashJobs: [StyleId, string, string][] = [];
	const counts = Object.fromEntries(STYLES.map(s => [s.id, 0])) as Record<StyleId, number>;

	const imagesFor = (hexcode: string): number => {
		const key = outputKey(hexcode);
		const canon = canonicalFromHex(hexcode);
		let bits = 0;
		for (const style of STYLES) {
			const image = indexes[style.set].files.get(canon)?.image;
			if (image) {
				bits |= style.bit;
				counts[style.id]++;
				hashJobs.push([style.id, key, image]);
			}
		}
		return bits;
	};

	// Positions.
	const total = targets.length;
	const [cols, rows] = gridFor(total);
	let next = 0;
	const position = (): Pos => {
		const pos: Pos = [next % cols, Math.floor(next / cols)];
		next++;
		return pos;
	};

	const compactEmoji: CompactEmoji[] = [];
	const verboseEmoji: VerboseEmoji[] = [];

	for (const emoji of data) {
		const key = outputKey(emoji.hexcode);
		const ecodes = codes.get(key)!;
		const pos = position();
		const images = imagesFor(emoji.hexcode);

		const fullName = eb.names[emoji.hexcode] ?? emoji.label.toUpperCase();
		const derived = ecodes[0]!.toUpperCase().replace(/_/g, ' ');

		let versions: CompactVersion[] | 0 = 0;
		let vverbose: VerboseVersion[] | null = null;
		if (emoji.skins) {
			versions = [];
			vverbose = [];
			for (const skin of emoji.skins) {
				const vkey = outputKey(skin.hexcode);
				const vcodes = codes.get(vkey)!;
				const vpos = position();
				const vimages = imagesFor(skin.hexcode);
				versions.push([vkey, vpos, vimages, skin.tone, skin.type, fromCodes(vcodes)]);
				vverbose.push({ key: vkey, pos: vpos, images: vimages, tone: skin.tone, codes: vcodes, type: skin.type });
			}
		}

		compactEmoji.push([emoji.group!, emoji.order!, fromCodes(ecodes), fullName !== derived ? fullName : 0, key, pos, images, versions, emoji.type]);
		verboseEmoji.push({ key, group: emoji.group!, order: emoji.order!, name: fullName, codes: ecodes, type: emoji.type, pos, images, versions: vverbose });
	}

	// Hash every source image so changed artwork shows up in diffs.
	await pool(hashJobs, 32, async ([style, key, file]) => {
		manifest[style][key] = sha256(await fs.readFile(file)).slice(0, 16);
	});
	for (const style of STYLES)
		manifest[style.id] = Object.fromEntries(Object.entries(manifest[style.id]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));

	// Sheets are published under a version derived from everything that determines their pixels.
	const sheets = sha256(JSON.stringify({ e: compactEmoji, manifest, SHEET_SIZES, SHEET_PADDING, SHEET_KERNEL, IMAGE_SIZE, grid: [cols, rows] })).slice(0, 12);

	const compact: CompactData = {
		v: 3,
		n: counts.noto,
		b: counts.blob,
		t: counts.twemoji,
		o: counts.openmoji,
		d: counts.noto3d,
		c: eb.groups,
		e: compactEmoji,
		g: [cols, rows],
		s: sheets,
	};

	const verbose: VerboseData = {
		v: 3,
		emojibase: eb.version,
		notos: counts.noto,
		blobs: counts.blob,
		twemojis: counts.twemoji,
		openmojis: counts.openmoji,
		noto3ds: counts.noto3d,
		grid: [cols, rows],
		sheets,
		categories: eb.groups,
		emoji: verboseEmoji,
	};

	return { compact, verbose, manifest };
}
