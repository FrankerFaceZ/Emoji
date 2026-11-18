/*
pnpm images: write dist/images/<style>/<key>.png|svg and the sprite sheets,
then optimize every PNG with oxipng.

Output layout matches /static/emoji/ on the CDN:
  dist/v3.3.json                (written by pnpm data)
  dist/images/<style>/<key>.png
  dist/images/sheets/<version>/sheet-<style>-<size>.png
  dist/build.json
*/

import fs from 'node:fs/promises';
import path from 'node:path';

import { STYLES } from '../config.ts';
import { Findings } from '../findings.ts';
import { validateCompact } from '../format.ts';
import { buildStyle } from '../images.ts';
import { COMPACT_FILE, DIST, DIST_IMAGES, PUBLISHED_DATA_NAME } from '../paths.ts';
import { indexAll, loadSources } from '../sources.ts';
import { findOxipng, oxipng } from '../tools.ts';
import { exists, fail, isCI, readJson, sha256, writeJson } from '../util.ts';

const started = performance.now();
const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s`;

const findings = new Findings();
if (!await exists(COMPACT_FILE))
	fail('dist/v3.3.json is missing. Run "pnpm data" first.');
const data: unknown = await readJson(COMPACT_FILE);
if (!validateCompact(data, 'dist/v3.3.json', findings) || !data.g || !data.s) {
	findings.print();
	fail('dist/v3.3.json is from an old build. Run "pnpm data" first.');
}

const tool = await findOxipng();
if (!tool) {
	if (isCI)
		fail('oxipng is required in CI. Run "pnpm tools".');
	console.warn('Warning: oxipng not found, so images will not be optimized. Run "pnpm tools" to install it.\n');
}

const sources = await loadSources();
const indexes = await indexAll(sources, findings);
if (findings.errors.length) {
	findings.print();
	fail('Image sources are incomplete. Run "pnpm sources".');
}

await fs.rm(DIST_IMAGES, { recursive: true, force: true });
await fs.mkdir(DIST_IMAGES, { recursive: true });

const sheets: string[] = [];
for (const style of STYLES) {
	const out = await buildStyle(style, data, indexes, DIST_IMAGES);
	sheets.push(...out.sheets);
	console.log(`${style.id}: ${out.singles} png (${out.resized} resized), ${out.svgs} svg, ${out.sheets.length} sheets [${elapsed()}]`);
}

if (tool) {
	console.log(`Optimizing with ${tool.version}...`);
	await oxipng(tool.bin, [DIST_IMAGES]);
	console.log(`  done [${elapsed()}]`);
}

const files: Record<string, { bytes: number, sha256: string }> = {};
for (const file of sheets) {
	const buf = await fs.readFile(file);
	files[path.relative(DIST, file).replaceAll('\\', '/')] = { bytes: buf.length, sha256: sha256(buf) };
}

await writeJson(path.join(DIST, 'build.json'), {
	data: PUBLISHED_DATA_NAME,
	grid: data.g,
	sheets: data.s,
	optimizer: tool?.version ?? null,
	files,
});

console.log('\nSheets:');
for (const [file, info] of Object.entries(files))
	console.log(`  ${file}  ${(info.bytes / 1024).toFixed(0)} KB`);
console.log(`\nDone in ${elapsed()}.`);
