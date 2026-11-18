/*
Safety checks. Each one exists because of a way this pipeline has broken (or
could break) without anyone noticing:

- checkCoverage:  an upstream repo moves or renames its images (Blobmoji did;
                  the 2023 rebuild shipped zero Blob images).
- checkOutput:    the data is internally inconsistent (duplicate keys, clashing
                  shortcodes, sprite positions off the grid, categories the
                  client has no label for).
- simulateClient: the data parses, but the client would mis-handle it (unknown
                  tones, names that overwrite each other).
- checkBaseline:  compared to what shipped, an emoji, shortcode, or image went
                  missing. Allowed only via allow.json.
- checkImages:    the files on disk don't match the data (missing singles,
                  sheet cells in the wrong place, wrong sheet size).
*/

import fs from 'node:fs/promises';
import path from 'node:path';

import sharp, { type OutputInfo } from 'sharp';

import type { Allow } from './allow.ts';
import { ALL_STYLE_BITS, CLIENT_CATEGORIES, CLIENT_TONES, IMAGE_SIZE, SHEET_KERNEL, SHEET_PADDING, SHEET_SIZES, SHORTCODE_PATTERN, STYLES, type ImageSetId, type StyleDef } from './config.ts';
import type { Manifest } from './data.ts';
import type { Shipped } from './shipped.ts';
import type { Emojibase } from './emojibase.ts';
import { Findings } from './findings.ts';
import { cells, gridOf, type Cell, type CompactData } from './format.ts';
import { clearTransparent, sheetDims, sheetPath, toTile } from './images.ts';
import { canonicalFromHex, keyToString } from './keys.ts';
import type { SourceIndex } from './sources.ts';
import { pool } from './util.ts';

// ============================================================================
// Source coverage
// ============================================================================

/** Each source should cover nearly every emoji emojibase knows. A big drop means files moved. */
export function checkCoverage(eb: Emojibase, indexes: Record<ImageSetId, SourceIndex>, findings: Findings) {
	const hexes: string[] = [];
	for (const emoji of eb.data)
		hexes.push(emoji.hexcode, ...(emoji.skins ?? []).map(s => s.hexcode));

	for (const style of STYLES) {
		const index = indexes[style.set];
		let have = 0;
		for (const hex of hexes)
			if (index.files.get(canonicalFromHex(hex))?.image)
				have++;
		const pct = have / hexes.length;
		// Blob is archived at Emoji 15.1, so it covers less every year; Noto fills the gaps.
		const min = style.fallback ? 0.75 : 0.95;
		const msg = `${style.id}: ${have} of ${hexes.length} emoji have an image (${(pct * 100).toFixed(1)}%).`;
		if (pct < min)
			findings.error('coverage', `${msg} Expected at least ${min * 100}%. Upstream probably moved or renamed its files.`);
		else
			findings.info('coverage', msg);
	}
}

// ============================================================================
// Output structure
// ============================================================================

export function checkOutput(data: CompactData, findings: Findings) {
	const list = cells(data);
	const [cols, rows] = gridOf(data);

	if (!data.g || !data.s)
		findings.error('output-sheets', 'The data has no sprite grid (g) or sheet version (s). New clients need both.');

	// Keys
	const keys = new Map<string, number>();
	const canon = new Map<string, string>();
	for (const cell of list) {
		keys.set(cell.key, (keys.get(cell.key) ?? 0) + 1);
		const c = canonicalFromHex(cell.key);
		if (canon.has(c) && canon.get(c) !== cell.key)
			findings.error('output-key', `${cell.key} and ${canon.get(c)} are the same emoji apart from FE0F.`);
		canon.set(c, cell.key);
	}
	const dupKeys = [...keys].filter(([, n]) => n > 1).map(([k]) => k);
	if (dupKeys.length)
		findings.error('output-key', `${dupKeys.length} keys appear more than once.`, dupKeys);

	// Positions
	const used = new Map<string, string>();
	const off: string[] = [], clash: string[] = [];
	for (const cell of list) {
		const [x, y] = cell.pos;
		if (x >= cols || y >= rows)
			off.push(`${cell.key} @ ${x},${y}`);
		const id = `${x},${y}`;
		if (used.has(id))
			clash.push(`${cell.key} and ${used.get(id)} @ ${id}`);
		used.set(id, cell.key);
	}
	if (off.length)
		findings.error('output-position', `${off.length} sprite positions are outside the ${cols}x${rows} grid.`, off);
	if (clash.length)
		findings.error('output-position', `${clash.length} sprite positions are used twice.`, clash);
	if (data.g && cols * (rows - 1) >= list.length)
		findings.warn('output-position', `The ${cols}x${rows} grid has a whole empty row for ${list.length} cells.`);

	// Categories
	const unknownCats = Object.entries(data.c).filter(([, slug]) => !CLIENT_CATEGORIES.includes(slug)).map(([id, slug]) => `${id}: ${slug}`);
	if (unknownCats.length)
		findings.error('output-category', 'Emojibase has categories the client has no label for. Add them to CATEGORIES in the client and to CLIENT_CATEGORIES here.', unknownCats);
	const noCat = list.filter(c => !(String(c.group) in data.c)).map(c => `${c.key} (group ${c.group})`);
	if (noCat.length)
		findings.error('output-category', `${noCat.length} emoji are in a group that isn't in the category list.`, noCat);

	// Shortcodes
	const owner = new Map<string, string>();
	const dupCodes: string[] = [], badCodes: string[] = [], noCodes: string[] = [];
	for (const cell of list) {
		if (!cell.codes.length)
			noCodes.push(cell.key);
		for (const code of cell.codes) {
			if (!SHORTCODE_PATTERN.test(code))
				badCodes.push(`${code} (${cell.key})`);
			const other = owner.get(code);
			if (other && other !== cell.key)
				dupCodes.push(`${code}: ${other}, ${cell.key}`);
			owner.set(code, cell.key);
		}
	}
	if (noCodes.length)
		findings.error('output-shortcode', `${noCodes.length} emoji have no shortcode. The client uses the first one as the name.`, noCodes);
	if (dupCodes.length)
		findings.error('output-shortcode', `${dupCodes.length} shortcodes belong to more than one emoji.`, dupCodes);
	if (badCodes.length)
		findings.error('output-shortcode', `${badCodes.length} shortcodes have unexpected characters.`, badCodes);

	// Tones
	const badTones = list
		.filter(c => c.parent && ![c.tone].flat().every(t => typeof t === 'number' && CLIENT_TONES.includes(t)))
		.map(c => `${c.key}: ${JSON.stringify(c.tone)}`);
	if (badTones.length)
		findings.error('output-tone', `${badTones.length} skin tone versions have tones the client doesn't know.`, badTones);

	// Counters
	for (const style of STYLES) {
		const actual = list.filter(c => c.images & style.bit).length;
		const field = style.counter;
		// Counters newer than the 2020 format may be absent when no emoji has that style.
		if ((data[field] ?? 0) !== actual)
			findings.error('output-count', `"${field}" says ${data[field] ?? 'nothing'} for ${style.id} images, but ${actual} emoji have one.`);
	}

	const unknownBits = list.filter(c => c.images & ~ALL_STYLE_BITS).map(c => c.key);
	if (unknownBits.length)
		findings.error('output-images', `${unknownBits.length} emoji have image bits for styles that don't exist.`, unknownBits);

	const noImage = list.filter(c => !c.images).map(c => c.key);
	if (noImage.length)
		findings.warn('output-no-image', `${noImage.length} emoji have no image in any style. They only work with native emoji.`, noImage);
}

// ============================================================================
// Client simulation
// ============================================================================

const SKIN_TONES: Record<number, string> = { 1: '1f3fb', 2: '1f3fc', 3: '1f3fd', 4: '1f3fe', 5: '1f3ff' };

/**
A port of Emoji.loadEmojiData() and hydrate_emoji() from the client
(src/modules/chat/emoji.js). The client never complains; it silently lets one
emoji overwrite another. This makes those cases visible.
*/
export function simulateClient(data: CompactData, findings: Findings): { emoji: number, names: number } {
	const out = new Map<string, string>();
	const names = new Map<string, string>();
	const chars = new Map<string, string>();
	const problems: string[] = [];

	const hydrate = (r: readonly unknown[]) => {
		let code = r[0] as string;
		if (r[4] === 0)
			code = `${code}-fe0f`;
		return { code, raw: keyToString(code) };
	};

	const register = (code: string, raw: string, list: string[], from: string) => {
		if (out.has(code))
			problems.push(`code ${code} from ${from} replaces ${out.get(code)}`);
		out.set(code, from);
		if (chars.has(raw) && chars.get(raw) !== from)
			problems.push(`text of ${from} replaces ${chars.get(raw)}`);
		chars.set(raw, from);
		for (const name of list) {
			if (names.has(name) && names.get(name) !== code)
				problems.push(`:${name}: from ${from} replaces ${names.get(name)}`);
			names.set(name, code);
		}
	};

	for (const raw of data.e) {
		const base = hydrate(raw.slice(4));
		const list = [raw[2]].flat();
		if (!list[0]) {
			problems.push(`${raw[4]} has no name`);
			continue;
		}
		register(base.code, base.raw, list, raw[4]);

		if (!raw[7])
			continue;
		for (const r of raw[7]) {
			const v = hydrate(r);
			if (Array.isArray(r[3]) || !r[3]) {
				// Multi-tone versions become separate (hidden) emoji in the client.
				register(v.code, v.raw, [r[5]].flat(), r[0]);
				continue;
			}
			if (!SKIN_TONES[r[3]]) {
				problems.push(`${r[0]} has unknown tone ${r[3]}`);
				continue;
			}
			if (chars.has(v.raw) && chars.get(v.raw) !== r[0])
				problems.push(`text of ${r[0]} replaces ${chars.get(v.raw)}`);
			chars.set(v.raw, r[0]);
		}
	}

	if (problems.length)
		findings.error('client', `${problems.length} problems when the client loads this data.`, problems);
	return { emoji: out.size, names: names.size };
}

// ============================================================================
// Baseline comparison
// ============================================================================

export interface BaselineSummary {
	added: Cell[];
	changed: Record<string, string[]>;
}

export function checkBaseline(
	data: CompactData,
	base: Shipped,
	manifest: Manifest | null,
	baseManifest: Manifest | null,
	allow: Allow,
	findings: Findings,
): BaselineSummary {
	const now = new Map(cells(data).map(c => [c.key, c]));
	const before = base;

	// Emoji
	const removed = [...before.keys()].filter(k => !now.has(k));
	const removedBad = removed.filter(k => !allow.removedEmoji[k]);
	if (removedBad.length)
		findings.error('removed-emoji', `${removedBad.length} emoji that shipped before are gone. If that's intended, list them in allow.json "removedEmoji".`, removedBad);
	if (removed.length > removedBad.length)
		findings.info('removed-emoji', `${removed.length - removedBad.length} emoji were removed (allowed in allow.json).`, removed.filter(k => allow.removedEmoji[k]));

	const added = [...now.values()].filter(c => !before.has(c.key));
	if (added.length)
		findings.info('added-emoji', `${added.length} new emoji (including skin tone versions).`, added.map(c => `${c.key} :${c.codes[0]}:`));

	// Shortcodes
	const beforeOwner = new Map<string, string>();
	for (const [key, c] of before)
		for (const code of c.codes)
			beforeOwner.set(code, key);
	const nowOwner = new Map<string, string>();
	for (const c of now.values())
		for (const code of c.codes)
			nowOwner.set(code, c.key);

	const lostCodes: string[] = [], movedCodes: string[] = [];
	for (const [code, key] of beforeOwner) {
		const current = nowOwner.get(code);
		if (!current) {
			if (!allow.dropShortcodes[code] && !allow.removedEmoji[key])
				lostCodes.push(`:${code}: (${key})`);
		} else if (current !== key)
			movedCodes.push(`:${code}: ${key} => ${current}`);
	}
	if (lostCodes.length)
		findings.error('removed-shortcode', `${lostCodes.length} shortcodes that shipped before are gone. If that's intended, list them in allow.json "dropShortcodes".`, lostCodes);
	if (movedCodes.length)
		findings.error('moved-shortcode', `${movedCodes.length} shortcodes now point at a different emoji.`, movedCodes);

	const newCodes = [...nowOwner.keys()].filter(c => !beforeOwner.has(c));
	if (newCodes.length)
		findings.info('added-shortcode', `${newCodes.length} new shortcodes.`, newCodes.map(c => `:${c}:`));

	const primary: string[] = [];
	const regrouped: string[] = [];
	const retyped: string[] = [];
	for (const [key, c] of now) {
		const old = before.get(key);
		if (!old)
			continue;
		if (old.codes[0] !== c.codes[0])
			primary.push(`${key}: :${old.codes[0]}: => :${c.codes[0]}:`);
		if (old.group !== c.group)
			regrouped.push(`${key}: ${data.c[old.group] ?? old.group} => ${data.c[c.group] ?? c.group}`);
		if (old.type !== c.type)
			retyped.push(`${key}: ${old.type} => ${c.type}`);
	}
	if (primary.length)
		findings.warn('primary-shortcode', `${primary.length} emoji have a different first shortcode, which changes their name in tooltips.`, primary);
	if (regrouped.length)
		findings.warn('regrouped', `${regrouped.length} emoji moved to a different category.`, regrouped);
	if (retyped.length)
		findings.warn('presentation', `${retyped.length} emoji changed between text and emoji presentation. This changes whether FE0F is added when sending.`, retyped);

	// Images. What matters to a viewer is whether the style shows anything: a
	// style with a fallback (Blob, Noto 3D) still shows the fallback's image.
	for (const style of STYLES) {
		const shown = style.bit | (style.fallback ? STYLES.find(s => s.id === style.fallback)!.bit : 0);
		const lost: string[] = [], gained: string[] = [], fellBack: string[] = [];
		for (const [key, c] of now) {
			const old = before.get(key);
			if (!old)
				continue;
			const had = !!(old.images & style.bit), has = !!(c.images & style.bit);
			if (had && !has) {
				if (allow.lostImages[`${style.id}:${key}`])
					continue;
				if (c.images & shown)
					fellBack.push(key);
				else
					lost.push(key);
			} else if (!had && has)
				gained.push(key);
		}
		if (lost.length)
			findings.error('lost-image', `${style.id}: ${lost.length} emoji had an image and no longer show anything in this style. If that's intended, list them in allow.json "lostImages" as "${style.id}:<key>".`, lost);
		if (fellBack.length)
			findings.warn('fallback-image', `${style.id}: ${fellBack.length} emoji had their own image and now use the ${style.fallback} fallback. Check upstream didn't drop designs by mistake.`, fellBack);
		if (gained.length)
			findings.info('gained-image', `${style.id}: ${gained.length} existing emoji gained an image.`, gained);
	}

	// Changed artwork, against the last release's manifest (the caller says when there is none).
	const changed: Record<string, string[]> = {};
	if (manifest && baseManifest) {
		for (const style of STYLES) {
			const a = baseManifest[style.id] ?? {}, b = manifest[style.id] ?? {};
			const diff = Object.keys(b).filter(k => a[k] && a[k] !== b[k]);
			changed[style.id] = diff;
			if (diff.length)
				findings.info('changed-image', `${style.id}: ${diff.length} images have new artwork upstream.`, diff);
		}
	}

	return { added, changed };
}

// ============================================================================
// Built images
// ============================================================================

async function readTile(file: string): Promise<Buffer | null> {
	try {
		const { data, info } = await sharp(file).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
		if (info.width !== IMAGE_SIZE || info.height !== IMAGE_SIZE || info.channels !== 4)
			return null;
		return clearTransparent(data);
	} catch {
		return null;
	}
}

function expects(style: StyleDef, cell: Cell): boolean {
	if (cell.images & style.bit)
		return true;
	if (!style.fallback)
		return false;
	return !!(cell.images & STYLES.find(s => s.id === style.fallback)!.bit);
}

export async function checkImages(data: CompactData, root: string, findings: Findings) {
	if (!data.g || !data.s) {
		findings.error('images', 'The data has no sheet version, so the images can\'t be checked.');
		return;
	}
	const list = cells(data);

	for (const style of STYLES) {
		const dir = path.join(root, style.id);
		const tiles = new Array<Buffer | null>(list.length).fill(null);
		const missing: string[] = [], broken: string[] = [], blank: string[] = [];

		await pool(list, 32, async (cell, i) => {
			if (!expects(style, cell))
				return;
			const file = path.join(dir, `${cell.key}.png`);
			try {
				await fs.access(file);
			} catch {
				missing.push(cell.key);
				return;
			}
			const tile = await readTile(file);
			if (!tile) {
				broken.push(cell.key);
				return;
			}
			let alpha = 0;
			for (let p = 3; p < tile.length; p += 4)
				alpha += tile[p]!;
			if (!alpha)
				blank.push(cell.key);
			tiles[i] = tile;
		});

		if (missing.length)
			findings.error('image-missing', `${style.id}: ${missing.length} images are missing.`, missing);
		if (broken.length)
			findings.error('image-broken', `${style.id}: ${broken.length} images don't decode to ${IMAGE_SIZE}x${IMAGE_SIZE} RGBA.`, broken);
		if (blank.length)
			findings.error('image-blank', `${style.id}: ${blank.length} images are fully transparent.`, blank);

		const expected = new Set(list.filter(c => expects(style, c)).map(c => `${c.key}.png`));
		const extra = (await fs.readdir(dir).catch(() => [] as string[])).filter(f => f.endsWith('.png') && !expected.has(f));
		if (extra.length)
			findings.warn('image-extra', `${style.id}: ${extra.length} PNG files aren't referenced by the data.`, extra);

		for (const size of SHEET_SIZES) {
			const file = sheetPath(root, data.s, style.id, size);
			let sheet: { data: Buffer, info: OutputInfo };
			try {
				sheet = await sharp(file, { limitInputPixels: false }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
			} catch {
				findings.error('sheet-missing', `${style.id}: sheet ${path.relative(root, file)} is missing or unreadable.`);
				continue;
			}
			const [w, h] = sheetDims(data.g, size);
			if (sheet.info.width !== w || sheet.info.height !== h) {
				findings.error('sheet-size', `${style.id}-${size}: sheet is ${sheet.info.width}x${sheet.info.height}, expected ${w}x${h} for a ${data.g[0]}x${data.g[1]} grid.`);
				continue;
			}

			const cell = size + SHEET_PADDING * 2;
			const wrong: string[] = [], dirty: string[] = [];
			// Exact comparison for every cell at 72px, and every 10th at smaller sizes (each needs a resize).
			await pool(list, 32, async (c, i) => {
				const x0 = c.pos[0] * cell, y0 = c.pos[1] * cell;
				const tile = tiles[i];
				if (!tile) {
					// Whole cell, padding included, must be empty.
					for (let y = 0; y < cell; y++)
						for (let x = 0; x < cell; x++)
							if (sheet.data[((y0 + y) * w + x0 + x) * 4 + 3]) {
								dirty.push(c.key);
								return;
							}
					return;
				}
				if (size !== IMAGE_SIZE && i % 10)
					return;
				const want = size === IMAGE_SIZE ? tile : await toTile(tile, size, true, SHEET_KERNEL);
				for (let y = 0; y < size; y++) {
					const offset = ((y0 + SHEET_PADDING + y) * w + x0 + SHEET_PADDING) * 4;
					if (!sheet.data.subarray(offset, offset + size * 4).equals(want.subarray(y * size * 4, (y + 1) * size * 4))) {
						wrong.push(`${c.key} @ ${c.pos[0]},${c.pos[1]}`);
						return;
					}
				}
			});
			if (wrong.length)
				findings.error('sheet-cell', `${style.id}-${size}: ${wrong.length} sheet cells don't match the emoji's image. Sprite positions are probably off.`, wrong);
			if (dirty.length)
				findings.error('sheet-cell', `${style.id}-${size}: ${dirty.length} cells should be empty but aren't.`, dirty);
		}
	}
}
