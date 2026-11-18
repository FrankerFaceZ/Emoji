import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Findings } from '../src/findings.ts';
import { assignShortcodes, type ShortcodeSet, type ShortcodeTarget } from '../src/shortcodes.ts';

const targets: ShortcodeTarget[] = [
	{ key: '1f603', hexcode: '1F603', label: 'grinning face with big eyes' },
	{ key: '1f604', hexcode: '1F604', label: 'grinning face with smiling eyes' },
	{ key: '1f44e', hexcode: '1F44E', label: 'thumbs down' },
	{ key: '1fae8', hexcode: '1FAE8', label: 'shaking face' },
];

const sets: ShortcodeSet[] = [
	{ name: 'emojibase', dashes: false, codes: { '1F603': ['grinning_face_with_big_eyes', 'smiley'], '1F604': ['smile'], '1F44E': '-1', '1FAE8': ['shaking', 'shaking_face'] } },
	{ name: 'github', dashes: true, codes: { '1F44E': ['-1', 'thumbsdown'], '1F604': 'smile' } },
];

const previous = new Map([
	['1f603', ['smile', 'smiley']],
	['1f44e', ['-1', '_1']],
]);

test('shipped shortcodes stay where they were, in the same order', () => {
	const f = new Findings();
	const out = assignShortcodes(targets, sets, previous, new Set(), f);
	assert.deepEqual(out.get('1f603'), ['smile', 'smiley', 'grinning_face_with_big_eyes']);
	// "smile" moved upstream; we keep it on 1f603 and report the collision.
	assert.ok(f.list.some(x => x.code === 'shortcode-collision'));
	// 1f604 lost its only upstream code to 1f603, so it gets one from its label.
	assert.deepEqual(out.get('1f604'), ['grinning_face_with_smiling_eyes']);
	assert.ok(f.list.some(x => x.code === 'shortcode-fallback'));
});

test('github and iamcal dashes become underscores, like the 2020 scripts', () => {
	const out = assignShortcodes(targets, sets, previous, new Set(), new Findings());
	assert.deepEqual(out.get('1f44e'), ['-1', '_1', 'thumbsdown']);
});

test('new emoji have codes sorted by similarity to the label', () => {
	const out = assignShortcodes(targets, sets, previous, new Set(), new Findings());
	assert.deepEqual(out.get('1fae8'), ['shaking_face', 'shaking']);
});

test('allow.json dropShortcodes removes a code everywhere', () => {
	const out = assignShortcodes(targets, sets, previous, new Set(['smiley']), new Findings());
	assert.deepEqual(out.get('1f603'), ['smile', 'grinning_face_with_big_eyes']);
});
