'use strict';

/*
Download missing Noto emoji images from Google's CDN.
This mainly pulls in national flags.
*/

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const util = require('util');

const exists = util.promisify(fs.exists);
const pipeline = util.promisify(require('stream').pipeline);

let data = require('emojibase-data/en/data.json');
const regional = require('./regional_indicators');

data = data.concat(regional);

const PNG_PATH = `sources/noto/png/128/`,
	SVG_PATH = `sources/noto/svg/`;

const aliases = {};

try {
	const raw_aliases = fs.readFileSync('sources/noto/emoji_aliases.txt', {encoding: 'utf8'}).split(/\n+/);
	for(const line of raw_aliases) {
		const match = /^\s*([0-9a-f_]+);([0-9a-f_]+)/i.exec(line);
		if ( match )
			aliases[match[1]] = match[2];
	}

} catch(err) {
	console.log('Unable to load aliases.');
	console.error(err);
}


async function saveImage(key, svg = false) {
	const resp = await fetch(`https://fonts.gstatic.com/s/e/notoemoji/latest/${key}/${svg ? 'emoji.svg' : '128.png'}`);
	if ( ! resp.ok )
		return false;

	await pipeline(resp.body, fs.createWriteStream(path.join(svg ? SVG_PATH : PNG_PATH, `emoji_u${key}.${svg ? 'svg' : 'png'}`)));
	return true;
}

let success = 0, failed = 0, copied = 0, existing = 0;

async function checkImage(key, svg = false) {
	const noto_key = key.toLowerCase().replace(/^([^-]+)-fe0f\b/i, (_, m) => m).replace(/-fe0f$/i, '').replace(/-/g, '_'),
		noto_path = path.join(svg ? SVG_PATH : PNG_PATH, `emoji_u${noto_key}.${svg ? 'svg' : 'png'}`);

	if ( await exists(noto_path) ) {
		existing++;
		return;
	}

	if ( aliases[noto_key] ) {
		const alias_path = path.join(svg ? SVG_PATH : PNG_PATH, `emoji_u${aliases[noto_key]}.${svg ? 'svg' : 'png'}`);
		console.log(`Alias:`, key, `=>`, aliases[noto_key]);
		if ( await exists(alias_path) ) {
			await fs.promises.copyFile(alias_path, noto_path);
			console.log(' -- Copied!');
			copied++;
		} else {
			console.log(' -- Not Found');
			failed++;
		}

		return;
	}

	console.log(`Downloading ${svg ? 'SVG' : 'PNG'}:`, key, noto_key);
	if ( await saveImage(noto_key, svg) ) {
		console.log(' -- Success!');
		success++;
	} else {
		console.log(' -- Failed');
		failed++;
	}
}


async function main() {
	for(const emoji of data) {
		if ( emoji.skins ) {
			for(const version of emoji.skins) {
				await checkImage(version.hexcode);
				await checkImage(version.hexcode, true);
			}
		}

		await checkImage(emoji.hexcode);
		await checkImage(emoji.hexcode, true);
	}

	console.log(`Downloaded ${success} and copied ${copied} of ${success + failed + copied} missing images. ${existing} already existed.`);
}

main();