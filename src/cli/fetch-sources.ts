/*
pnpm sources: download every pinned upstream source into .cache/sources.
Already-present sources at the right pin are skipped.
*/

import type { SourceId } from '../config.ts';
import { loadEmojibase } from '../emojibase.ts';
import { Findings } from '../findings.ts';
import { canonicalFromHex } from '../keys.ts';
import { ensureSource, fetchGstatic, indexSet, loadSources } from '../sources.ts';
import { fail } from '../util.ts';

const sources = await loadSources();

console.log('Fetching sources:');
for (const id of Object.keys(sources) as SourceId[]) {
	const src = sources[id];
	try {
		const fetched = await ensureSource(id, src);
		if (!fetched)
			console.log(`  ${id}: ${src.ref} (cached)`);
	} catch (err) {
		fail(err instanceof Error ? err.message : String(err));
	}
}

// Fill gaps in Noto (flags, mostly) from Google's emoji CDN.
const noto = sources.noto;
if (noto.kind === 'git' && noto.gstatic) {
	const findings = new Findings();
	const eb = await loadEmojibase(findings);
	if (!eb) {
		findings.print();
		fail('emojibase-data failed validation.');
	}
	const index = await indexSet('noto', sources, findings);
	const missing: string[] = [];
	for (const emoji of eb.data)
		for (const hex of [emoji.hexcode, ...(emoji.skins ?? []).map(s => s.hexcode)])
			if (!index.files.get(canonicalFromHex(hex))?.image)
				missing.push(hex);

	if (missing.length) {
		console.log(`  noto: ${missing.length} emoji have no image in the repo, checking fonts.gstatic.com (${noto.gstatic})`);
		const result = await fetchGstatic(noto.gstatic, missing);
		console.log(`     downloaded ${result.fetched} files, ${result.missing.length} not available${result.missing.length ? `: ${result.missing.join(', ')}` : ''}`);
	}
}

console.log('Done.');
