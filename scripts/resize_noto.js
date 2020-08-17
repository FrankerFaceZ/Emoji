'use strict';

/*
Resize Noto and Blob images to 72x72, which is our desired source image size.
Note: This script is based off a script from the emoji-data library.
      See: README.md for more.
*/

const fs = require('fs');
const cp = require('child_process');
const util = require('util');

const execFile = util.promisify(cp.execFile);

const SOURCE = `sources/noto/png/128`,
	DEST = `sources/noto/png/72`,

	BLOB_SOURCE = `sources/blobmoji/png/128`,
	BLOB_DEST = `sources/blobmoji/png/72`;

async function main() {

	try {
		await execFile('mogrify', ['-version']);
	} catch(err) {
		if ( err.code === 'ENOENT' )
			console.warn('Error: mogrify not found. Please install ImageMagick.');
		else
			console.error(err);
		return;
	}

	await fs.promises.mkdir(DEST, {recursive: true});
	await fs.promises.mkdir(BLOB_DEST, {recursive: true});

	const result = await Promise.all([
		execFile('mogrify', [
			'-gravity', 'center',
			'-background', 'transparent',
			'-extent', '72x72',
			'-path', `png32:${DEST}`,
			`${SOURCE}/*.png[72x72]`
		]),
		execFile('mogrify', [
			'-gravity', 'center',
			'-background', 'transparent',
			'-extent', '72x72',
			'-path', `png32:${BLOB_DEST}`,
			`${BLOB_SOURCE}/*.png[72x72]`
		])
	]);


	if ( result[0].stderr && result[0].strerr.length )
		console.error(result[0].stderr);
	if ( reuslt[1].stderr && result[1].stderr.length )
		console.error(result[1].stderr);

	console.log(`Complete.`);
	console.log(result[0].stdout);
	console.log(result[1].stdout);
}

main();