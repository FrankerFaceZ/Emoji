'use strict';

/*
Compile all of our data sources into the final data structures and save
them out as JSON files.
*/

const fs = require('fs');
const path = require('path');
const {distance} = require('fastest-levenshtein');

/** @type {import('emojibase').Emoji[]} */
let data = require('emojibase-data/en/data.json');
const categories = require('emojibase-data/meta/groups.json');
const names = require('emojibase-data/meta/unicode-names.json')

const patch_regional_indicators = require('./regional_indicators.js')
patch_regional_indicators(data)
const { get_shortcodes: get_emojibase_shortcodes } = require("./shortcodes_util.js")

const NOTO_PATH = `sources/noto/png/128/`,
	BLOB_PATH = `sources/blobmoji/png/128/`,
	TWEMOJI_PATH = `sources/twemoji/assets/72x72/`,
	OPENMOJI_PATH = `sources/openmoji/color/72x72/`;


let add_shortcodes;
try {
	add_shortcodes = JSON.parse(fs.readFileSync('extra-shortcodes.json', {encoding: 'utf8'}));
} catch(err) {
	console.log('Error loading extra shortcodes.');
	console.error(err);
	add_shortcodes = {};
}


let notos = 0, blobs = 0, twemojis = 0, openmojis = 0;

function getImages(key) {
	const key_lower = key.toLowerCase(),
		noto_key = key_lower.replace(/^([^-]+)-fe0f\b/i, (_, m) => m).replace(/-fe0f$/i, '').replace(/-/g, '_'),

		noto = path.join(NOTO_PATH, `emoji_u${noto_key}.png`),
		blob = path.join(BLOB_PATH, `emoji_u${noto_key}.png`),
		twemoji = path.join(TWEMOJI_PATH, `${key_lower}.png`),
		openmoji = path.join(OPENMOJI_PATH, `${key}.png`);

	const has_noto = fs.existsSync(noto),
		has_blob = fs.existsSync(blob),
		has_twemoji = fs.existsSync(twemoji),
		has_openmoji = fs.existsSync(openmoji);

	if ( has_noto )
		notos++;

	if ( has_blob )
		blobs++;

	if ( has_twemoji )
		twemojis++;

	if ( has_openmoji )
		openmojis++;

	return ( has_noto ? 0b1000 : 0) +
		(    has_blob ? 0b0100 : 0) +
		( has_twemoji ? 0b0010 : 0) +
		(has_openmoji ? 0b0001 : 0);
}


// First, we need to count the variants + the base emoji
let count = 0;
for(const emoji of data) {
	count++;
	if ( emoji.skins )
		count += emoji.skins.length;
}

let rows = Math.floor(Math.sqrt(count)),
	cols = rows;

if ( rows * cols < count )
	cols++;
if ( rows * cols < count )
	rows++;

console.log('Count:', count);
console.log(' Size:', `${cols}x${rows}`, `(${cols * rows})`);

let row = 0, col = 0;

function getPosition() {
	const out = [col++, row];
	if ( col >= cols ) {
		col = 0;
		row++;
	}

	return out;
}

const out = [],
	out_compact = [];

let skipped = 0;

for(const emoji of data) {
	let versions = null, versions_compact = null;
	if ( emoji.skins ) {
		versions = [];
		versions_compact = [];
		for(const version of emoji.skins) {
			let version_shortcodes = get_emojibase_shortcodes(version.hexcode)
			const version_name = names[version.hexcode]
			const pos = getPosition(),
				extra = add_shortcodes[version.hexcode];

			if ( Array.isArray(extra) )
				for(const code of extra)
					if ( ! version_shortcodes.includes(code) )
						version_shortcodes.push(code);

			if ( version_shortcodes.length > 1 && version_name ) {
				const test = version_name.toLowerCase().replace(/ /g, '_');
				version_shortcodes = version_shortcodes
					.map(code => [distance(test, code), code])
					.sort((a, b) => a[0] - b[0])
					.map(x => x[1]);
			}

			versions.push({
				key: version.hexcode.toLowerCase(),
				pos,
				images: getImages(version.hexcode),
				tone: version.tone,
				codes: version_shortcodes,
				type: version.type
			});

			versions_compact.push([
				version.hexcode.toLowerCase(),
				pos,
				getImages(version.hexcode),
				version.tone,
				version.type,
				version_shortcodes.length === 1 ? version_shortcodes[0] : version_shortcodes
			]);
		}
	}

	let emoji_shortcodes = get_emojibase_shortcodes(emoji.hexcode)
	const emoji_name = names[emoji.hexcode]
	const pos = getPosition(),
		extra = add_shortcodes[emoji.hexcode];

	if ( Array.isArray(extra) )
		for(const code of extra)
			if ( ! emoji_shortcodes.includes(code) )
			emoji_shortcodes.push(code);

	if ( emoji_shortcodes.length > 1 && emoji_name ) {
		const test = emoji_name.toLowerCase().replace(/ /g, '_');
		emoji_shortcodes = emoji_shortcodes
			.map(code => [distance(test, code), code])
			.sort((a, b) => a[0] - b[0])
			.map(x => x[1]);
	}

	const name_test = emoji_shortcodes[0].toUpperCase().replace(/_/g, ' '),
		name = emoji_name !== name_test && emoji_name;

	const key = emoji.hexcode.toLowerCase();

	out.push({
		key,
		group: emoji.group,
		order: emoji.order,
		name: emoji_name,
		codes: emoji_shortcodes,
		type: emoji.type,
		pos,
		images: getImages(emoji.hexcode),
		versions
	});

	out_compact.push([
		emoji.group,
		emoji.order,
		emoji_shortcodes.length === 1 ? emoji_shortcodes[0] : emoji_shortcodes,
		name || 0,
		key,
		pos,
		getImages(emoji.hexcode),
		versions_compact || 0,
		emoji.type
	]);
}

fs.writeFileSync('emoji-compact.json', JSON.stringify({v:3,n:notos,b:blobs,t:twemojis,o:openmojis,c:categories.groups,e:out_compact}), {encoding: 'utf8'});
fs.writeFileSync('emoji.json', JSON.stringify({v:3,notos,blobs,twemojis,openmojis,categories:categories.groups,emoji:out}, null, '\t'), {encoding: 'utf8'});
