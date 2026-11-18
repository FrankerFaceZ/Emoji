import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Allow } from '../src/allow.ts';
import { checkBaseline, checkOutput, simulateClient } from '../src/checks.ts';
import { gridFor } from '../src/data.ts';
import { Findings } from '../src/findings.ts';
import type { CompactData } from '../src/format.ts';
import { serializeShipped, parseShipped, shippedFromCompact } from '../src/shipped.ts';

const allowNone: Allow = { dropShortcodes: {}, removedEmoji: {}, lostImages: {} };

function sample(): CompactData {
	return {
		v: 3, n: 3, b: 0, t: 3, o: 0,
		c: { 0: 'smileys-emotion', 1: 'people-body' },
		g: [2, 2],
		s: 'abcdef123456',
		e: [
			[0, 1, ['grinning', 'grinning_face'], 0, '1f600', [0, 0], 0b1010, 0, 1],
			[1, 2, 'wave', 0, '1f44b', [1, 0], 0b1010, [['1f44b-1f3fb', [0, 1], 0b1010, 1, 1, 'wave_tone1']], 1],
		],
	};
}

const codes = (f: Findings) => f.errors.map(e => e.code);

test('a valid file passes', () => {
	const f = new Findings();
	checkOutput(sample(), f);
	simulateClient(sample(), f);
	assert.deepEqual(f.errors, []);
});

test('duplicate keys, clashing positions, and shared shortcodes are errors', () => {
	const d = sample();
	d.e.push([0, 3, 'grinning', 0, '1f601', [0, 0], 0b1010, 0, 1]);
	d.e.push([0, 4, 'grinning_again', 0, '1f600', [1, 1], 0b1010, 0, 1]);
	d.n = 5; d.t = 5;
	const f = new Findings();
	checkOutput(d, f);
	assert.ok(codes(f).includes('output-key'));
	assert.ok(codes(f).includes('output-position'));
	assert.ok(codes(f).includes('output-shortcode'));
});

test('a category the client has no label for is an error', () => {
	const d = sample();
	d.c[1] = 'people-and-body';
	const f = new Findings();
	checkOutput(d, f);
	assert.ok(codes(f).includes('output-category'));
});

test('an unknown skin tone is caught', () => {
	const d = sample();
	(d.e[1]![7] as [string, [number, number], number, number, 0 | 1, string][])[0]![3] = 6;
	const f = new Findings();
	checkOutput(d, f);
	simulateClient(d, f);
	assert.ok(codes(f).includes('output-tone'));
	assert.ok(codes(f).includes('client'));
});

test('wrong image counters are caught (the 2020 scripts double counted)', () => {
	const d = sample();
	d.n = 6;
	const f = new Findings();
	checkOutput(d, f);
	assert.ok(codes(f).includes('output-count'));
});

test('baseline: removed emoji, removed shortcodes, and lost images fail unless allowed', () => {
	const base = sample();
	const now = sample();
	now.e[0]![2] = 'grinning_face';
	now.e[1]![6] = 0b1000;
	now.e.splice(1, 1, [1, 2, 'wave', 0, '1f44b', [1, 0], 0b1000, 0, 1]);
	now.t = 1; now.n = 2;

	let f = new Findings();
	checkBaseline(now, shippedFromCompact(base), null, null, allowNone, f);
	assert.ok(codes(f).includes('removed-shortcode'));
	assert.ok(codes(f).includes('removed-emoji'));
	assert.ok(codes(f).includes('lost-image'));

	f = new Findings();
	checkBaseline(now, shippedFromCompact(base), null, null, {
		dropShortcodes: { grinning: 'test', wave_tone1: 'test' },
		removedEmoji: { '1f44b-1f3fb': 'test' },
		lostImages: { 'twemoji:1f44b': 'test' },
	}, f);
	assert.deepEqual(f.errors, []);
});

test('the sprite grid is as square as possible', () => {
	assert.deepEqual(gridFor(3998), [64, 63]);
	assert.deepEqual(gridFor(4096), [64, 64]);
	assert.deepEqual(gridFor(1), [1, 1]);
});

test('shipped.json is one sorted line per emoji and reads back the same', () => {
	const shipped = shippedFromCompact(sample());
	const text = serializeShipped(shipped);
	const lines = text.trimEnd().split('\n');
	assert.equal(lines.length, 3 + 2);
	assert.deepEqual([...text.matchAll(/^\t"([^"]+)"/gm)].map(m => m[1]), ['1f44b', '1f44b-1f3fb', '1f600']);
	assert.deepEqual(parseShipped(text, 'test', new Findings()), shipped);
	assert.equal(serializeShipped(parseShipped(text, 'test', new Findings())!), text);
});

test('a malformed shipped.json is an error, not an empty baseline', () => {
	const f = new Findings();
	assert.equal(parseShipped('{"1f600": {"codes": []}}', 'test', f), null);
	assert.ok(codes(f).includes('shipped-schema'));
});

test('a style that loses its own image but still shows its fallback is a warning, not an error', () => {
	const base = sample();
	base.e[0]![6] = 0b1110;  // noto, blob, twemoji
	base.n = 3; base.b = 1;
	const now = sample();   // 1f600 has noto + twemoji only: blob falls back to noto
	const f = new Findings();
	checkBaseline(now, shippedFromCompact(base), null, null, allowNone, f);
	assert.deepEqual(f.errors, []);
	assert.ok(f.warnings.some(w => w.code === 'fallback-image' && w.items?.includes('1f600')));
});
