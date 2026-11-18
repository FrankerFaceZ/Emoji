/*
Upstream image sources: pinning, fetching, and indexing.

Sources are pinned in sources.json, either as a git tag + commit (fetched with
a shallow, sparse, blobless clone so we only download the folders we use) or
as GitHub release assets (verified against a sha256). Everything lands in
.cache/sources/<name>@<ref>/, so bumping a pin never reuses stale files.
*/

import fs from 'node:fs/promises';
import path from 'node:path';

import { unzipSync } from 'fflate';

import type { ImageSetId, SourceId } from './config.ts';
import { Findings } from './findings.ts';
import { canonical, notoStem, parseCodepoints, parseImageName, type FileNaming } from './keys.ts';
import { SOURCES_DIR, SOURCES_FILE } from './paths.ts';
import { exec, exists, pool, readJson, sha256 } from './util.ts';

export interface GitSource {
	kind: 'git';
	repo: string;
	ref: string;
	commit: string;
	paths: string[];
	/** Noto only: version of Google's emoji CDN to fill gaps from (mostly flags). */
	gstatic?: string;
}

export interface ReleaseSource {
	kind: 'release';
	repo: string;
	ref: string;
	/** Asset file name => "sha256:<hex>" */
	assets: Record<string, string>;
	/** Upstream is archived. The update checker skips it. */
	frozen?: boolean;
}

export type Source = GitSource | ReleaseSource;
export type SourcesFile = Record<SourceId, Source>;

interface ImageSet {
	source: SourceId;
	/** PNG folder. Sets without one are drawn from their SVGs (sharp renders them with librsvg). */
	png?: string;
	svg?: string;
	naming: FileNaming;
	/** File (relative to the source dir) listing Noto-style aliases. */
	aliases?: string;
	/** Fill gaps from Google's emoji CDN (the source's `gstatic` version). */
	gstatic?: boolean;
	/**
	File (relative to the source dir) listing the SVG file names that belong to
	this set. Anything else in the folder is ignored, and the style falls back.
	*/
	only?: string;
}

/**
Where each image set lives, relative to its source's cache directory. Release
assets are extracted into png/ and svg/.
*/
export const IMAGE_SETS: Record<ImageSetId, ImageSet> = {
	twemoji: { source: 'twemoji', png: 'assets/72x72', svg: 'assets/svg', naming: 'plain' },
	noto: { source: 'noto', png: '2D/png/72', svg: '2D/svg', naming: 'noto', aliases: 'emoji_aliases.txt', gstatic: true },
	// Google's 3D set (new with the Unicode 18 release). PNG only. It covers every emoji today; any future gap falls back to 2D Noto.
	noto3d: { source: 'noto', png: '3D/png/72', naming: 'noto', aliases: 'emoji_aliases.txt' },
	openmoji: { source: 'openmoji', png: 'png', svg: 'svg', naming: 'plain' },
	// blobmoji2 (the continuation of the archived Blobmoji) is a fork of Noto: its svg/ folder also holds
	// Google's own designs. Only the files its list names are blob designs; the rest fall back to current Noto.
	blobmoji: { source: 'blobmoji', svg: 'svg', naming: 'noto', aliases: 'emoji_aliases.txt', only: 'blobmoji_svgs_list.txt' },
};

/** Lines in a set's `only` list must look like this. */
const ONLY_LINE = /^emoji_u[0-9a-f]{4,6}(_[0-9a-f]{4,6})*\.svg$/;

export const IMAGE_SET_IDS = Object.keys(IMAGE_SETS) as ImageSetId[];

const COMPLETE_MARKER = '.ffz-complete';

export async function loadSources(): Promise<SourcesFile> {
	return readJson<SourcesFile>(SOURCES_FILE);
}

export function sourceDir(id: SourceId, src: Source): string {
	return path.join(SOURCES_DIR, `${id}@${src.ref}`);
}

export function gstaticDir(version: string): string {
	return path.join(SOURCES_DIR, `noto-gstatic@${version}`);
}

function stamp(src: Source): string {
	return JSON.stringify(src);
}

// ============================================================================
// Fetching
// ============================================================================

async function git(args: string[], cwd?: string) {
	return exec('git', ['-c', 'advice.detachedHead=false', '-c', 'core.longpaths=true', ...args], { cwd, maxBuffer: 64 * 1024 * 1024 });
}

async function fetchGit(id: SourceId, src: GitSource): Promise<void> {
	const dir = sourceDir(id, src);
	for (const set of Object.values(IMAGE_SETS).filter(s => s.source === id))
		for (const p of [set.png, set.svg])
			if (p && !src.paths.includes(p))
				throw new Error(`sources.json: ${id}.paths must include "${p}"`);

	await fs.rm(dir, { recursive: true, force: true });
	await fs.mkdir(path.dirname(dir), { recursive: true });

	console.log(`  ${id}: cloning ${src.repo}@${src.ref} (sparse: ${src.paths.join(', ')})`);
	await git(['clone', '--quiet', '--filter=blob:none', '--no-checkout', '--depth', '1', '--branch', src.ref, `https://github.com/${src.repo}.git`, dir]);
	await git(['sparse-checkout', 'init', '--cone'], dir);
	await git(['sparse-checkout', 'set', ...src.paths], dir);
	await git(['checkout', '--quiet', src.ref], dir);

	const { stdout } = await git(['rev-parse', 'HEAD'], dir);
	const head = stdout.trim();
	if (head !== src.commit)
		throw new Error(`${id}: tag ${src.ref} points at ${head}, but sources.json pins ${src.commit}. The tag moved upstream. Check it, then update the pin.`);
}

async function download(url: string): Promise<Uint8Array> {
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok)
		throw new Error(`GET ${url}: ${res.status} ${res.statusText}`);
	return new Uint8Array(await res.arrayBuffer());
}

/**
Extract the png/svg files from a zip into flat png/ and svg/ folders. Only the
base name of each entry is used, so archive paths can't escape the folder.
*/
async function extractImages(zip: Uint8Array, dir: string, label: string): Promise<number> {
	const files = unzipSync(zip, { filter: f => /\.(png|svg)$/i.test(f.name) && !f.name.includes('__MACOSX') });
	const seen = new Set<string>();
	let count = 0;
	for (const [name, data] of Object.entries(files)) {
		const base = path.posix.basename(name.replaceAll('\\', '/'));
		if (!/^[\w.\- ]+$/.test(base))
			throw new Error(`${label}: unexpected file name in archive: ${name}`);
		const ext = base.slice(base.lastIndexOf('.') + 1).toLowerCase();
		const out = path.join(dir, ext, base);
		if (seen.has(out))
			throw new Error(`${label}: archive has more than one file named ${base}`);
		seen.add(out);
		await fs.mkdir(path.dirname(out), { recursive: true });
		await fs.writeFile(out, data);
		count++;
	}
	return count;
}

async function fetchRelease(id: SourceId, src: ReleaseSource): Promise<void> {
	const dir = sourceDir(id, src);
	await fs.rm(dir, { recursive: true, force: true });
	await fs.mkdir(dir, { recursive: true });

	for (const [asset, digest] of Object.entries(src.assets)) {
		const url = `https://github.com/${src.repo}/releases/download/${encodeURIComponent(src.ref)}/${encodeURIComponent(asset)}`;
		console.log(`  ${id}: downloading ${asset}`);
		const data = await download(url);
		const actual = `sha256:${sha256(data)}`;
		if (actual !== digest)
			throw new Error(`${id}: ${asset} has digest ${actual}, but sources.json pins ${digest}.`);
		const count = await extractImages(data, dir, `${id}/${asset}`);
		console.log(`     extracted ${count} images`);
	}
}

/** Make sure a source is present in the cache at its pinned version. Returns true if it was fetched. */
export async function ensureSource(id: SourceId, src: Source): Promise<boolean> {
	const dir = sourceDir(id, src);
	const marker = path.join(dir, COMPLETE_MARKER);
	if (await exists(marker) && await fs.readFile(marker, 'utf8') === stamp(src))
		return false;

	if (src.kind === 'git')
		await fetchGit(id, src);
	else
		await fetchRelease(id, src);

	await fs.writeFile(marker, stamp(src), 'utf8');
	return true;
}

/**
Noto's repo has no images for flags (the font builds them from region-flags
with a wave effect). Google's emoji CDN serves the finished images, with a
versioned path, so we fill gaps from there.
*/
export async function fetchGstatic(version: string, hexcodes: Iterable<string>): Promise<{ fetched: number, missing: string[] }> {
	const dir = gstaticDir(version);
	await fs.mkdir(path.join(dir, 'png'), { recursive: true });
	await fs.mkdir(path.join(dir, 'svg'), { recursive: true });

	const stems = [...new Set([...hexcodes].map(h => notoStem(parseCodepoints(h))))].sort();
	let fetched = 0;
	const missing: string[] = [];

	await pool(stems, 8, async stem => {
		for (const [file, ext] of [['72.png', 'png'], ['emoji.svg', 'svg']] as const) {
			const out = path.join(dir, ext, `emoji_u${stem}.${ext}`);
			if (await exists(out))
				continue;
			const res = await fetch(`https://fonts.gstatic.com/s/e/notoemoji/${version}/${stem}/${file}`);
			if (res.status === 404) {
				if (ext === 'png')
					missing.push(stem);
				continue;
			}
			if (!res.ok)
				throw new Error(`gstatic ${stem}/${file}: ${res.status} ${res.statusText}`);
			const type = res.headers.get('content-type') ?? '';
			if (!type.startsWith(ext === 'png' ? 'image/png' : 'image/svg'))
				throw new Error(`gstatic ${stem}/${file}: unexpected content type "${type}"`);
			await fs.writeFile(out, new Uint8Array(await res.arrayBuffer()));
			fetched++;
		}
	});

	return { fetched, missing };
}

// ============================================================================
// Indexing
// ============================================================================

export interface ImageFiles {
	png?: string;
	svg?: string;
	/**
	What the build draws the style's images from: the PNG, or for a set
	without PNGs, the SVG. Only emoji with one count as having an image.
	*/
	image?: string;
}

export interface SourceIndex {
	id: ImageSetId;
	/** Canonical key => files */
	files: Map<string, ImageFiles>;
	/** Image files that didn't match the expected naming scheme. */
	unmatched: string[];
	pngCount: number;
	svgCount: number;
	aliased: number;
	/** Files left out because the set's `only` list doesn't name them. */
	excluded: number;
}

async function listDir(dir: string): Promise<string[] | null> {
	try {
		return await fs.readdir(dir);
	} catch {
		return null;
	}
}

interface IndexOptions {
	/** Record files that don't follow the naming scheme (for the set's main image format). */
	strict: boolean;
	/** If given, only these file names are indexed. */
	only?: Set<string>;
}

async function indexDir(dir: string, naming: FileNaming, ext: 'png' | 'svg', index: SourceIndex, opts: IndexOptions): Promise<boolean> {
	const names = await listDir(dir);
	if (!names)
		return false;
	for (const name of names) {
		if (!name.toLowerCase().endsWith(`.${ext}`))
			continue;
		if (opts.only && !opts.only.has(name)) {
			index.excluded++;
			continue;
		}
		const parsed = parseImageName(name, naming);
		if (!parsed) {
			if (opts.strict)
				index.unmatched.push(name);
			continue;
		}
		const entry = index.files.get(parsed.key) ?? {};
		if (!entry[ext])
			entry[ext] = path.join(dir, name);
		index.files.set(parsed.key, entry);
		if (ext === 'png') index.pngCount++;
		else index.svgCount++;
	}
	return true;
}

async function applyAliases(file: string, index: SourceIndex): Promise<void> {
	const text = await fs.readFile(file, 'utf8');
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*([0-9a-f_]+)\s*;\s*([0-9a-f_]+)/i.exec(line);
		if (!match)
			continue;
		const alias = canonical(parseCodepoints(match[1]!, '_'));
		const target = canonical(parseCodepoints(match[2]!, '_'));
		const files = index.files.get(target);
		if (files && !index.files.has(alias)) {
			index.files.set(alias, files);
			index.aliased++;
		}
	}
}

/**
Read a set's `only` list. Its format is part of the contract with upstream, so
anything unexpected is an error rather than a silently smaller set.
*/
async function readOnlyList(id: ImageSetId, file: string, findings: Findings): Promise<Set<string> | null> {
	let text: string;
	try {
		text = await fs.readFile(file, 'utf8');
	} catch {
		findings.error('source-layout', `${id}: the list of files to use ("${path.basename(file)}") is missing. Upstream may have moved or renamed it.`);
		return null;
	}
	const names = new Set<string>();
	const odd: string[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith('#'))
			continue;
		if (ONLY_LINE.test(line))
			names.add(line);
		else
			odd.push(line);
	}
	if (odd.length)
		findings.error('source-naming', `${id}: ${odd.length} lines of "${path.basename(file)}" aren't SVG file names. Upstream may have changed the list's format.`, odd);
	if (names.size < 1000)
		findings.error('source-layout', `${id}: "${path.basename(file)}" names only ${names.size} files. Upstream may have changed the list's format.`);
	return names;
}

export async function indexSet(id: ImageSetId, sources: SourcesFile, findings: Findings): Promise<SourceIndex> {
	const set = IMAGE_SETS[id];
	const src = sources[set.source];
	const dir = sourceDir(set.source, src);
	const index: SourceIndex = { id, files: new Map(), unmatched: [], pngCount: 0, svgCount: 0, aliased: 0, excluded: 0 };

	const only = set.only ? await readOnlyList(id, path.join(dir, set.only), findings) ?? new Set<string>() : undefined;

	if (set.png && !await indexDir(path.join(dir, set.png), set.naming, 'png', index, { strict: true, only }))
		findings.error('source-layout', `${id}: image folder "${set.png}" is missing. Run "pnpm sources", or upstream moved its files.`);
	if (set.svg && !await indexDir(path.join(dir, set.svg), set.naming, 'svg', index, { strict: !set.png, only }))
		findings.error('source-layout', `${id}: SVG folder "${set.svg}" is missing. Upstream may have moved its files.`);

	if (set.gstatic && src.kind === 'git' && src.gstatic) {
		const extra = gstaticDir(src.gstatic);
		await indexDir(path.join(extra, 'png'), 'noto', 'png', index, { strict: false });
		await indexDir(path.join(extra, 'svg'), 'noto', 'svg', index, { strict: false });
	}

	if (set.aliases) {
		const file = path.join(dir, set.aliases);
		if (await exists(file))
			await applyAliases(file, index);
		else
			findings.warn('source-layout', `${id}: alias list "${set.aliases}" is missing.`);
	}

	for (const entry of index.files.values())
		entry.image = set.png ? entry.png : entry.svg;

	const count = set.png ? index.pngCount : index.svgCount;
	if (index.unmatched.length > Math.max(5, count * 0.01))
		findings.error('source-naming', `${id}: ${index.unmatched.length} image files don't follow the expected "${set.naming}" naming. Upstream may have renamed its files.`, index.unmatched);
	else if (index.unmatched.length)
		findings.info('source-naming', `${id}: ${index.unmatched.length} image files with unexpected names were ignored.`, index.unmatched);

	return index;
}

export async function indexAll(sources: SourcesFile, findings: Findings): Promise<Record<ImageSetId, SourceIndex>> {
	const out = {} as Record<ImageSetId, SourceIndex>;
	for (const id of IMAGE_SET_IDS)
		out[id] = await indexSet(id, sources, findings);
	return out;
}
