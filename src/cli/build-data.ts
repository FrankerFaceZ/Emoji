/*
pnpm data: build dist/v3.3.json (what the client downloads), dist/emoji.json
(the same, spelled out), dist/manifest.json (source image hashes), and the
committed shipped.json.

Shortcodes are carried forward from shipped.json as committed at HEAD (or
--previous <ref>), so the result only depends on that and the pinned inputs.
Running it twice gives the same shipped.json.
*/

import fs from 'node:fs/promises';

import { loadAllow } from '../allow.ts';
import { STYLES } from '../config.ts';
import { buildData } from '../data.ts';
import { loadEmojibase } from '../emojibase.ts';
import { Findings } from '../findings.ts';
import { validateCompact } from '../format.ts';
import { COMPACT_FILE, DATA_FILE, DIST, MANIFEST_FILE, SHIPPED_FILE } from '../paths.ts';
import { loadShippedAt, parseShipped, serializeShipped, shippedFromCompact, type Shipped } from '../shipped.ts';
import { indexAll, loadSources } from '../sources.ts';
import { exists, fail, parseArgs, writeJson } from '../util.ts';

const args = parseArgs();
const findings = new Findings();

async function loadPrevious(ref: string): Promise<Shipped | null> {
	const found = await loadShippedAt(ref, findings);
	if (found) {
		console.log(`Carrying shortcodes forward from ${found.label}`);
		return found.shipped;
	}
	// Outside a git checkout (or before the first commit), use the file on disk.
	if (await exists(SHIPPED_FILE)) {
		console.log('Carrying shortcodes forward from shipped.json on disk');
		return parseShipped(await fs.readFile(SHIPPED_FILE, 'utf8'), 'shipped.json', findings);
	}
	console.log('Nothing has shipped yet: no shortcodes to carry forward');
	return null;
}

const eb = await loadEmojibase(findings);
if (!eb) {
	findings.print();
	fail('emojibase-data failed validation. Nothing was written.');
}
console.log(`emojibase-data ${eb.version}: ${eb.data.length} emoji`);

const sources = await loadSources();
const indexes = await indexAll(sources, findings);
for (const index of Object.values(indexes))
	console.log(`  ${index.id}: ${index.pngCount} png, ${index.svgCount} svg${index.aliased ? `, ${index.aliased} aliases` : ''}`);

const previous = await loadPrevious(args.get('previous') ?? 'HEAD');
const allow = await loadAllow();
const result = await buildData(eb, indexes, previous, allow, findings);

if (!validateCompact(result.compact, 'build output', findings) || findings.errors.length) {
	findings.print();
	fail('The data build has errors. Nothing was written.');
}

const { compact } = result;
await fs.mkdir(DIST, { recursive: true });
await fs.writeFile(COMPACT_FILE, JSON.stringify(compact), 'utf8');
await writeJson(DATA_FILE, result.verbose);
await writeJson(MANIFEST_FILE, result.manifest);
await fs.writeFile(SHIPPED_FILE, serializeShipped(shippedFromCompact(compact)), 'utf8');

let cellCount = 0;
for (const e of compact.e)
	cellCount += 1 + (e[7] ? e[7].length : 0);

console.log(`\nWrote ${compact.e.length} emoji (${cellCount} sprite cells, grid ${compact.g![0]}x${compact.g![1]}, sheets ${compact.s})`);
console.log(`Images: ${STYLES.map(s => `${s.id} ${compact[s.counter] ?? 0}`).join(', ')}`);
if (findings.list.length) {
	console.log('');
	findings.print();
}
