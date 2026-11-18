/*
pnpm check: run every safety check and write dist/report.md.

  --baseline <ref>            git ref whose shipped.json to compare against (default: HEAD)
  --baseline-manifest <file>  source image hashes of the last release, to list changed
                              artwork (default: downloaded from the latest GitHub release)
  --no-images                 skip checks that need dist/images (images and sheets)
  --report <file>             where to write the markdown report (default: dist/report.md)

Exits with status 1 if any check reports an error.
*/

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadAllow } from '../allow.ts';
import { checkBaseline, checkCoverage, checkImages, checkOutput, simulateClient } from '../checks.ts';
import type { Manifest } from '../data.ts';
import { loadEmojibase } from '../emojibase.ts';
import { Findings } from '../findings.ts';
import { cells, validateCompact, type CompactData } from '../format.ts';
import { COMPACT_FILE, DIST, DIST_IMAGES, DIST_PREVIEW, MANIFEST_FILE, PACKAGE_FILE, RELEASE_BASE, SHIPPED_FILE } from '../paths.ts';
import { renderPreview, renderReport } from '../report.ts';
import { loadShippedAt, serializeShipped, shippedFromCompact, type Shipped } from '../shipped.ts';
import { indexAll, loadSources } from '../sources.ts';
import { exists, jobSummary, parseArgs, readJson } from '../util.ts';

const args = parseArgs();
const baselineRef = args.get('baseline') ?? 'HEAD';
const reportFile = path.resolve(args.get('report') ?? path.join(DIST, 'report.md'));
const findings = new Findings();

const step = (name: string) => console.log(`\n== ${name}`);

/** Changed artwork is information, not a safety check, so a missing release only skips that list. */
async function loadBaseManifest(): Promise<Manifest | null> {
	const file = args.get('baseline-manifest');
	if (file)
		return readJson<Manifest>(file);
	try {
		const res = await fetch(`${RELEASE_BASE}/manifest.json`, { signal: AbortSignal.timeout(20_000) });
		if (res.ok)
			return await res.json() as Manifest;
		findings.info('changed-image', `The latest release has no manifest.json (${res.status}), so changed artwork isn't listed.`);
	} catch (err) {
		findings.info('changed-image', `Couldn't download the latest release's manifest.json, so changed artwork isn't listed: ${String(err)}`);
	}
	return null;
}

step('Inputs');
const eb = await loadEmojibase(findings);
const sources = await loadSources();
const indexes = await indexAll(sources, findings);
if (eb)
	checkCoverage(eb, indexes, findings);

step('Output');
if (!await exists(COMPACT_FILE)) {
	console.error(`${path.relative(process.cwd(), COMPACT_FILE)} is missing. Run "pnpm data" first.`);
	process.exit(1);
}
const raw: unknown = await readJson(COMPACT_FILE);
if (!validateCompact(raw, 'dist/v3.3.json', findings)) {
	findings.print();
	process.exit(1);
}
const data: CompactData = raw;
checkOutput(data, findings);
const client = simulateClient(data, findings);
console.log(`Client would load ${client.emoji} emoji and ${client.names} shortcodes.`);

// shipped.json is what gets committed; it must describe exactly this build.
const expected = serializeShipped(shippedFromCompact(data));
const onDisk = await exists(SHIPPED_FILE) ? await fs.readFile(SHIPPED_FILE, 'utf8') : null;
if (onDisk !== expected)
	findings.error('shipped', 'shipped.json doesn\'t match dist/v3.3.json. Run "pnpm data" and commit shipped.json.');

step(`Baseline (${baselineRef})`);
let baseline: Shipped | null = null;
let baselineLabel = `\`${baselineRef}\``;
const found = await loadShippedAt(baselineRef, findings);
if (found) {
	baseline = found.shipped;
	baselineLabel = `\`${found.label}\``;
	console.log(`Comparing with ${found.label}`);
} else
	findings.warn('baseline', `Nothing had shipped as of ${baselineRef}, so nothing was compared.`);

let added: ReturnType<typeof checkBaseline>['added'] = [];
let changed: Record<string, string[]> = {};
if (baseline) {
	const manifest = await exists(MANIFEST_FILE) ? await readJson<Manifest>(MANIFEST_FILE) : null;
	const baseManifest = manifest ? await loadBaseManifest() : null;
	({ added, changed } = checkBaseline(data, baseline, manifest, baseManifest, await loadAllow(), findings));
}

let sheets: Record<string, { bytes: number }> | undefined;
if (!args.has('no-images')) {
	step('Images');
	await checkImages(data, DIST_IMAGES, findings);
	const build = path.join(DIST, 'build.json');
	if (await exists(build))
		sheets = (await readJson<{ files: Record<string, { bytes: number }> }>(build)).files;

	await fs.rm(DIST_PREVIEW, { recursive: true, force: true });
	if (await renderPreview(added.slice(0, 300), DIST_IMAGES, path.join(DIST_PREVIEW, 'added.png')))
		console.log('Wrote dist/preview/added.png');
	const changedKeys = new Set(Object.values(changed).flat());
	const changedCells = cells(data).filter(c => changedKeys.has(c.key)).slice(0, 300);
	if (await renderPreview(changedCells, DIST_IMAGES, path.join(DIST_PREVIEW, 'changed.png')))
		console.log('Wrote dist/preview/changed.png');
}

const pkg = await readJson<{ dependencies: Record<string, string> }>(PACKAGE_FILE);
const versions: Record<string, string> = { 'emojibase-data': pkg.dependencies['emojibase-data'] ?? '?' };
for (const [id, src] of Object.entries(sources))
	versions[id] = `${src.repo}@${src.ref}`;

const report = renderReport({
	title: 'Emoji build',
	findings,
	data,
	baseline,
	baselineLabel,
	sheets,
	versions,
});
await fs.mkdir(path.dirname(reportFile), { recursive: true });
await fs.writeFile(reportFile, report, 'utf8');
await jobSummary(report);

console.log('');
findings.print();
console.log(`\n${findings.errors.length} errors, ${findings.warnings.length} warnings. Report: ${path.relative(process.cwd(), reportFile)}`);
process.exit(findings.errors.length ? 1 : 0);
