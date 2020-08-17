'use strict';

/*
Compile all of our data sources into the final data structures and save
them out as JSON files.
*/

const fs = require('fs');
const path = require('path');
const {distance} = require('fastest-levenshtein');

let data = require('emojibase-data/en/data.json');
const regional = require('./regional_indicators'),
	categories = require('emojibase-data/meta/groups.json');

data = data.concat(regional);

const NOTO_PATH = `sources/noto/png/128/`,
	BLOB_PATH = `sources/blobmoji/png/128/`,
	TWEMOJI_PATH = `sources/twemoji/assets/72x72/`,
	OPENMOJI_PATH = `sources/openmoji/color/72x72/`;


let shortcodes;
try {
	shortcodes = JSON.parse(fs.readFileSync('extra-shortcodes.json', {encoding: 'utf8'}));
} catch(err) {
	console.log('Error loading extra shortcodes.');
	console.error(err);
	shortcodes = {};
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
			const pos = getPosition(),
				extra = shortcodes[version.hexcode];

			if ( Array.isArray(extra) )
				for(const code of extra)
					if ( ! version.shortcodes.includes(code) )
						version.shortcodes.push(code);

			if ( version.shortcodes.length > 1 && version.name ) {
				const test = version.name.toLowerCase().replace(/ /g, '_');
				version.shortcodes = version.shortcodes
					.map(code => [distance(test, code), code])
					.sort((a, b) => a[0] - b[0])
					.map(x => x[1]);
			}

			versions.push({
				key: version.hexcode.toLowerCase(),
				pos,
				images: getImages(version.hexcode),
				tone: version.tone,
				codes: version.shortcodes,
				type: version.type
			});

			versions_compact.push([
				version.hexcode.toLowerCase(),
				pos,
				getImages(version.hexcode),
				version.tone,
				version.type,
				version.shortcodes.length === 1 ? version.shortcodes[0] : version.shortcodes
			]);
		}
	}

	const pos = getPosition(),
		extra = shortcodes[emoji.hexcode];

	if ( Array.isArray(extra) )
		for(const code of extra)
			if ( ! emoji.shortcodes.includes(code) )
			emoji.shortcodes.push(code);

	if ( emoji.shortcodes.length > 1 && emoji.name ) {
		const test = emoji.name.toLowerCase().replace(/ /g, '_');
		emoji.shortcodes = emoji.shortcodes
			.map(code => [distance(test, code), code])
			.sort((a, b) => a[0] - b[0])
			.map(x => x[1]);
	}

	const name_test = emoji.shortcodes[0].toUpperCase().replace(/_/g, ' '),
		name = emoji.name !== name_test && emoji.name;

	const key = emoji.hexcode.toLowerCase();

	out.push({
		key,
		group: emoji.group,
		order: emoji.order,
		name: emoji.name,
		codes: emoji.shortcodes,
		type: emoji.type,
		pos,
		images: getImages(emoji.hexcode),
		versions
	});

	out_compact.push([
		emoji.group,
		emoji.order,
		emoji.shortcodes.length === 1 ? emoji.shortcodes[0] : emoji.shortcodes,
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
