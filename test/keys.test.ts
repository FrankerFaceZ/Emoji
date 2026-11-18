import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonicalFromHex, keyToString, notoStem, parseCodepoints, parseImageName } from '../src/keys.ts';

test('every source naming scheme maps to the same canonical key', () => {
	const want = canonicalFromHex('0023-FE0F-20E3');
	assert.equal(want, '23-20e3');
	assert.equal(parseImageName('emoji_u0023_20e3.png', 'noto')?.key, want);
	assert.equal(parseImageName('23-20e3.png', 'plain')?.key, want);
	assert.equal(parseImageName('0023-FE0F-20E3.svg', 'plain')?.key, want);
});

test('FE0F inside ZWJ sequences is ignored', () => {
	assert.equal(canonicalFromHex('1F636-200D-1F32B-FE0F'), '1f636-200d-1f32b');
	assert.equal(parseImageName('emoji_u1f636_200d_1f32b.png', 'noto')?.key, '1f636-200d-1f32b');
});

test('noto stems are zero padded and drop FE0F', () => {
	assert.equal(notoStem(parseCodepoints('A9')), '00a9');
	assert.equal(notoStem(parseCodepoints('1F1FA-1F1F8')), '1f1fa_1f1f8');
	assert.equal(notoStem(parseCodepoints('2764-FE0F-200D-1F525')), '2764_200d_1f525');
});

test('names that do not follow the scheme are rejected', () => {
	assert.equal(parseImageName('accordion.svg', 'plain'), null);
	assert.equal(parseImageName('1f600.png', 'noto'), null);
	assert.equal(parseImageName('emoji_u1f600.jpg', 'noto'), null);
});

test('keyToString matches what the client builds', () => {
	assert.equal(keyToString('1f44b-1f3fb'), '\u{1F44B}\u{1F3FB}');
	assert.throws(() => parseCodepoints('zz'));
});
