'use strict';

/*
Copy our image source files to the directory structure we want.
*/

const fs = require('fs');
const util = require('util');

const exists = util.promisify(fs.exists);

const data = JSON.parse(fs.readFileSync('emoji.json', {encoding: 'utf8'}));


const NOTO_PATH = {
		svg: `sources/noto/svg`,
		png: `sources/noto/png/72`,
	},
	BLOB_PATH = {
		svg: `sources/blobmoji/svg`,
		png: `sources/blobmoji/png/72`
	},
	TWEMOJI_PATH = {
		svg: `sources/twemoji/assets/svg`,
		png: `sources/twemoji/assets/72x72`
	},
	OPENMOJI_PATH = {
		svg: `sources/openmoji/color/svg`,
		png: `sources/openmoji/color/72x72`
	};


let copied = 0, missing = 0, skipped = 0;

function decodeImages(images) {
	return {
		noto:     images & 0b1000,
		blob:     images & 0b0100,
		twemoji:  images & 0b0010,
		openmoji: images & 0b0001
	};
}

async function copyImages(key, images) {
	const key_upper = key.toUpperCase(),
		key_lower = key.toLowerCase(),
		key_noto = key_lower.replace(/^([^-]+)-fe0f\b/i, (_, m) => m).replace(/-fe0f$/i, '').replace(/-/g, '_');

	const pairs = [];

	for(const ext of ['svg', 'png']) {
		// Noto
		if ( images.noto ) {
			pairs.push([
				`${NOTO_PATH.svg}/emoji_u${key_noto}.svg`,
				`images/noto/${key_lower}.svg`
			]);

			pairs.push([
				`${NOTO_PATH.png}/emoji_u${key_noto}.png`,
				`images/noto/${key_lower}.png`
			]);
		}

		// Blob
		if ( images.blob ) {
			pairs.push([
				`${BLOB_PATH.svg}/emoji_u${key_noto}.svg`,
				`images/blob/${key_lower}.svg`
			]);

			pairs.push([
				`${BLOB_PATH.png}/emoji_u${key_noto}.png`,
				`images/blob/${key_lower}.png`
			]);

		// Blob Noto Fallback
		} else if ( images.noto ) {
			pairs.push([
				`${NOTO_PATH.svg}/emoji_u${key_noto}.svg`,
				`images/blob/${key_lower}.svg`
			]);

			pairs.push([
				`${NOTO_PATH.png}/emoji_u${key_noto}.png`,
				`images/blob/${key_lower}.png`
			]);
		}

		// Twemoji
		if ( images.twemoji ) {
			pairs.push([
				`${TWEMOJI_PATH.png}/${key_lower}.png`,
				`images/twemoji/${key_lower}.png`
			]);

			pairs.push([
				`${TWEMOJI_PATH.svg}/${key_lower}.svg`,
				`images/twemoji/${key_lower}.svg`
			]);
		}

		// Openmoji
		if ( images.openmoji ) {
			pairs.push([
				`${OPENMOJI_PATH.png}/${key_upper}.png`,
				`images/openmoji/${key_lower}.png`
			]);

			pairs.push([
				`${OPENMOJI_PATH.svg}/${key_upper}.svg`,
				`images/openmoji/${key_lower}.svg`
			]);
		}
	}

	const existing = await Promise.all(pairs.map(x => exists(x[0]))),
		there = await Promise.all(pairs.map(x => exists(x[1]))),
		promises = [];

	for(let i=0; i < pairs.length; i++) {
		if ( ! existing[i] ) {
			console.log(`Missing: ${pairs[i][0]}`);
			missing++;
			continue;
		}

		if ( there[i] ) {
			skipped++;
			continue;
		}

		copied++;
		promises.push(fs.promises.copyFile(pairs[i][0], pairs[i][1]).catch(err => {
			console.log(`Error: ${pairs[i][0]}`);
			console.error(err);
			copied--;
			missing++;
		}));
	}

	await Promise.all(promises);
}

async function main() {

	fs.mkdirSync(`images/noto`, {recursive: true});
	fs.mkdirSync(`images/blob`, {recursive: true});
	fs.mkdirSync(`images/twemoji`, {recursive: true});
	fs.mkdirSync(`images/openmoji`, {recursive: true});

	for(const emoji of data.emoji) {
		await copyImages(emoji.key, decodeImages(emoji.images));
		if ( emoji.versions )
			for(const version of emoji.versions)
				await copyImages(version.key, decodeImages(version.images));
	}

	console.log(`Copied ${copied} images. ${missing} missing. Skipped ${skipped} existing.`);
}

main();