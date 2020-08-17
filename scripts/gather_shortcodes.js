'use strict';

/*
Download a list of shortcodes from GitHub's API. Also pull in short codes
from the emoji-data project, which FFZ used to use for emoji data.
*/

const fs = require('fs');
const fetch = require('node-fetch');

let data = require('emojibase-data/en/data.json');
const regional = require('./regional_indicators');

data = data.concat(regional);

const GITHUB_MATCHER = /^https:\/\/github.githubassets.com\/images\/icons\/emoji\/unicode\/([0-9a-f_-]+)/;

const existing_codes = new Set;
const native_codes = {};
for(const emoji of data) {
	native_codes[emoji.hexcode] = emoji.shortcodes;
	for(const code of emoji.shortcodes)
		existing_codes.add(code);

	if ( emoji.skins ) {
		for(const skin of emoji.skins) {
			native_codes[skin.hexcode] = skin.shortcodes;
			for(const code of skin.shortcodes)
				existing_codes.add(code);
		}
	}
}

let added = 0, existing = 0, github = 0, iamcal = 0;

function normalizeCode(code) {
	return code.replace(/-/g, '_');
}


async function fetchGitHub() {
	const resp = await fetch('https://api.github.com/emojis');
	if ( ! resp.ok )
		return {};

	let data;
	try {
		data = await resp.json();
	} catch(err) {
		console.error(err);
		return {};
	}

	const out = {};
	for(const [code, url] of Object.entries(data)) {
		const match = GITHUB_MATCHER.exec(url);
		if ( ! match || ! match[1] )
			continue;

		const hex = match[1].toUpperCase(),
			codes = native_codes[hex],
			ncode = normalizeCode(code);

		if ( ! codes )
			continue;

		if ( ! codes.includes(ncode) && ! existing_codes.has(ncode) ) {
			const emoji = out[hex] = out[hex] || [];
			emoji.push(ncode);
			existing_codes.add(ncode);
			added++;
			github++;
		} else
			existing++;
	}

	return out;
}


function fetchIamcal() {
	let data;
	try {
		data = require('emoji-datasource');
	} catch(err) {
		console.error(err);
		return {};
	}

	const out = {};
	for(const emoji of data) {
		const hex = emoji.unified.toUpperCase(),
			codes = native_codes[hex];

		if ( ! codes )
			continue;

		for(const code of emoji.short_names) {
			const ncode = normalizeCode(code);

			if ( ! codes.includes(ncode) && ! existing_codes.has(ncode) ) {
				const em = out[hex] = out[hex] || [];
				em.push(ncode);
				existing_codes.add(ncode);
				added++;
				iamcal++;
			} else
				existing++;
		}
	}

	return out;
}



async function main() {
	const ia = await fetchIamcal();
	const codes = await fetchGitHub();


	for(const [key, val] of Object.entries(ia)) {
		const data = codes[key];
		if ( ! data )
			codes[key] = val;
		else
			for(const code of val)
				if ( ! data.includes(code) )
					data.push(code);
	}

	console.log(`Found ${added} additional codes across ${Object.keys(codes).length} emoji. Ignored ${existing} existing codes. GitHub: ${github} -- Iamcal: ${iamcal}`);

	await fs.promises.writeFile('extra-shortcodes.json', JSON.stringify(codes, null, '\t'), {encoding: 'utf8'})
}

main();