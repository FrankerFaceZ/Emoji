'use strict';

/*
Build sprite sheets from the source images.
Note: This script is based off a script from the emoji-data library.
      See: README.md for more.
*/

const fs = require('fs');
const cp = require('child_process');
const util = require('util');

const execFile = util.promisify(cp.execFile);


const data = JSON.parse(fs.readFileSync('emoji.json', {encoding: 'utf8'}));

let max_row = 0, max_col = 0, count = 0;

const sources = {
	noto: [],
	blob: [],
	twemoji: [],
	openmoji: []
};

function decodeImages(images) {
	return {
		noto:     images & 0b1000,
		blob:     images & 0b0100,
		twemoji:  images & 0b0010,
		openmoji: images & 0b0001
	};
}


async function main() {

	for(const emoji of data.emoji) {
		if ( emoji.versions )
			for(const version of emoji.versions) {
				const images = decodeImages(version.images);
				count++;

				for(const source of ['noto', 'blob', 'twemoji', 'openmoji']) {
					let image = 'null:';
					if ( images[source] || (source === 'blob' && images.noto) )
						image = `images/${source}/${version.key}.png`;

					sources[source].push(image);
				}

				max_col = Math.max(max_col, version.pos[0]);
				max_row = Math.max(max_row, version.pos[1]);
			}

		const images = decodeImages(emoji.images);
		count++;

		for(const source of ['noto', 'blob', 'twemoji', 'openmoji']) {
			let image = 'null:';
			if ( images[source] || (source === 'blob' && images.noto) )
				image = `images/${source}/${emoji.key}.png`;

			sources[source].push(image);
		}

		max_col = Math.max(max_col, emoji.pos[0]);
		max_row = Math.max(max_row, emoji.pos[1]);

	}

	console.log('Count:', count);
	console.log(' Size:', `${max_col+1}x${max_row+1}`);

	// Make sure we have montage.
	try {
		await execFile('montage', ['-version']);
	} catch(err) {
		if ( err.code === 'ENOENT' )
			console.warn('Error: montage not found. Please install ImageMagick.');
		else
			console.error(err);
		return;
	}

	const tile = `${max_col+1}x${max_row+1}`;

	for(const source of ['noto', 'blob', 'twemoji', 'openmoji']) {
		for(const size of [72, 36, 18]) {
			const geometry = `${size}x${size}+1+1`;

			console.log(`Building: ${source} - ${size}x`);

			const result = await execFile('montage', [
				...sources[source],
				'-geometry',
				geometry,
				'-tile',
				tile,
				'-background',
				'none',
				`png32:images/sheet-${source}-${size}.png`
			]);

			if ( result.stderr && result.strerr.length )
				console.error(result.stderr);
			else
				console.log(` -- Done!`);
		}
	}

	console.log('Complete.');
}

main();