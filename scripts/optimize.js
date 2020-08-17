'use strict';

/*
Optimize all images using several methods and picking the best
one for each image. This takes a while.
Note: This script is based off a script from the emoji-data library.
      See: README.md for more.
*/

const fs = require('fs');
const cp = require('child_process');
const util = require('util');
const process = require('process');
const rimraf = util.promisify(require('rimraf'));

const execFile = util.promisify(cp.execFile);

/* Config */

const strip_meta = true;
const level = 5;

const zopfli_strat = 0;

let use_pngcrush = true,
	use_optipng = true,
	use_pngout = false,
	use_zopfli = false,
	use_advpng = true;

/* Program */

function decodeImages(images) {
	return {
		noto:     images & 0b1000,
		blob:     images & 0b0100,
		twemoji:  images & 0b0010,
		openmoji: images & 0b0001
	};
}


const time = {};

const addTime = (key, val) => {
	time[key] = (time[key] || 0n) + val;
}



async function usePNGCrush(image, size, small, large) {
	const args = [];
	if ( small || (level >= 6 && ! large) )
		args.push('-brute');

	if ( strip_meta ) {
		args.push('-rem');
		args.push('alla');
	}

	args.push('-nofilecheck');
	args.push('-bail');
	args.push('-blacken');
	args.push('-reduce');

	args.push(image);
	args.push('tmp/pngcrush.png');

	const start = process.hrtime.bigint();

	try {
		await execFile('pngcrush', args);
	} catch(err) {
		addTime('pngcrush', process.hrtime.bigint() - start);
		return [false];
	}

	addTime('pngcrush', process.hrtime.bigint() - start);

	let stats;
	try {
		stats = await fs.promises.stat('tmp/pngcrush.png');
	} catch(err) {
		return [false];
	}
	if ( ! stats || stats.size >= size )
		return [false];

	return [
		true,
		stats.size,
		'pngcrush',
		'tmp/pngcrush.png'
	];
}

async function useOptipng(image, size, small, large) {
	let opti = level + 1;
	if ( opti > 7 )
		opti = 7;
	if ( opti < 3 )
		opti = 3;

	const start = process.hrtime.bigint();

	try {
		await fs.promises.copyFile(image, 'tmp/optipng.png');

		await execFile('optipng', [
			`-o${opti}`,
			'-quiet',
			'tmp/optipng.png'
		]);
	} catch(err) {
		addTime('optipng', process.hrtime.bigint() - start);
		return [false];
	}

	addTime('optipng', process.hrtime.bigint() - start);

	let stats;
	try {
		stats = await fs.promises.stat('tmp/optipng.png');
	} catch(err) {
		return [false];
	}
	if ( ! stats || stats.size >= size )
		return [false];

	return [
		true,
		stats.size,
		'optipng',
		'tmp/optipng.png'
	];
}

async function usePngout(image, size, small, large) {
	let lvl = 1;
	if ( level >= 4 )
		lvl = 0;
	if ( large )
		lvl++;

	const args = [];
	if ( ! strip_meta )
		args.push('-k1');
	if ( lvl > 0 )
		args.push(`-s${lvl}`);

	args.push('-r');
	args.push('-q');

	args.push(image);
	args.push('tmp/pngout.png');

	const start = process.hrtime.bigint();

	try {
		await execFile('pngout-static', args);
	} catch(err) {
		addTime('pngout', process.hrtime.bigint() - start);
		return [false];
	}

	addTime('pngout', process.hrtime.bigint() - start);

	let stats;
	try {
		stats = await fs.promises.stat('tmp/pngout.png');
	} catch(err) {
		return [false];
	}
	if ( ! stats || stats.size >= size )
		return [false];

	return [
		true,
		stats.size,
		'pngout',
		'tmp/pngout.png'
	];
}

async function useAdvpng(image, size, small, large) {
	let lvl = level;
	if ( lvl > 4 )
		lvl = 4;
	if ( lvl < 1 )
		lvl = 1;

	const start = process.hrtime.bigint();

	try {
		await fs.promises.copyFile(image, 'tmp/advpng.png');

		await execFile('advpng', [
			`-${lvl}`,
			'--recompress',
			'--quiet',
			'tmp/advpng.png'
		]);
	} catch(err) {
		addTime('advpng', process.hrtime.bigint() - start);
		return [false];
	}

	addTime('advpng', process.hrtime.bigint() - start);

	let stats;
	try {
		stats = await fs.promises.stat('tmp/advpng.png');
	} catch(err) {
		return [false];
	}
	if ( ! stats || stats.size >= size )
		return [false];

	return [
		true,
		stats.size,
		'advpng',
		'tmp/advpng.png'
	];
}

async function useZopfli(image, size, small, large) {
	let filters = '0pme';
	let limit_mul = 0.8;

	if ( zopfli_strat === 1 )
		limit_mul = 1.4;

	let time_limit = Math.round(Math.min(8 + level * 13, 10 + size/2014) * limit_mul);
	let iterations;

	if ( large ) {
		iterations = Math.round(5 + (3 + 3 * level) / 3);
		filters = 'p';
	} else
		iterations = 3 + 3 * level;

	if ( zopfli_strat === 1 )
		filters = 'bp';

	const args = [];
	if ( iterations > 0 )
		args.push(`--iterations=${iterations}`);

	args.push(`--filters=${filters}`);

	if ( ! strip_meta )
		args.push(`--keepchunks=tEXt,zTXt,iTXt,gAMA,sRGB,iCCP,bKGD,pHYs,sBIT,tIME,oFFs,acTL,fcTL,fdAT,prVW,mkBF,mkTS,mkBS,mkBT`);

	args.push('--lossy_transparent');
	args.push('-y');

	args.push(image);
	args.push('tmp/zopfli.png');

	const start = process.hrtime.bigint();

	try {
		await execFile('zopflipng', args);
	} catch(err) {
		addTime('zopfli', process.hrtime.bigint() - start);
		return [false];
	}

	addTime('zopfli', process.hrtime.bigint() - start);

	let stats;
	try {
		stats = await fs.promises.stat('tmp/zopfli.png');
	} catch(err) {
		return [false];
	}
	if ( ! stats || stats.size >= size )
		return [false];

	return [
		true,
		stats.size,
		'zopfli',
		'tmp/zopfli.png'
	];


}


async function main() {

	if ( use_pngcrush )
		try {
			await execFile('pngcrush', ['--version'])
		} catch(err) {
			console.warn('Unable to find pngcrush');
			use_pngcrush = false;
		}

	if ( use_optipng )
		try {
			await execFile('optipng', ['--version'])
		} catch(err) {
			console.warn('Unable to find optipng');
			use_optipng = false;
		}

	if ( use_pngout )
		try {
			await execFile('pngout-static', ['--version'])
		} catch(err) {
			console.warn('Unable to find pngout-static');
			use_pngout = false;
		}

	if ( use_advpng )
		try {
			await execFile('advpng', ['--version'])
		} catch(err) {
			console.warn('Unable to find advpng');
			use_advpng = false;
		}

	if ( use_zopfli )
		try {
			await execFile('zopflipng', ['--version'])
		} catch(err) {
			console.warn('Unable to find zopflipng');
			use_zopfli = false;
		}

	if ( level < 4 && use_zopfli )
		use_pngout = false;
	if ( level < 2 && use_optipng )
		use_pngcrush = false;

	if ( ! use_pngcrush && ! use_optipng && ! use_pngout && ! use_zopfli && ! use_advpng ) {
		console.warn('No image optimizers available.');
		return;
	}

	const data = JSON.parse(fs.readFileSync('emoji.json', {encoding: 'utf8'}));
	const images_set = new Set;

	for(const source of ['noto', 'blob', 'twemoji', 'openmoji'])
		for(const size of [72, 36, 18])
			images_set.add(`images/sheet-${source}-${size}.png`);


	for(const emoji of data.emoji) {
		if ( emoji.versions )
			for(const version of emoji.versions) {
				const images = decodeImages(version.images);
				for(const source of ['noto', 'blob', 'twemoji', 'openmoji'])
					if ( images[source] || (source === 'blob' && images.noto) )
						images_set.add(`images/${source}/${version.key}.png`);
			}

		const images = decodeImages(emoji.images);
		for(const source of ['noto', 'blob', 'twemoji', 'openmoji'])
			if ( images[source] || (source === 'blob' && images.noto) )
				images_set.add(`images/${source}/${emoji.key}.png`);
	}

	console.log(`Found ${images_set.size} images to process.`);

	let saved = 0, processed = 0, errors = 0;
	const sources = {};

	try {
		await rimraf('tmp');
	} catch(err) {
		console.error(err);
		return;
	}

	try {
		await fs.promises.mkdir('tmp');
	} catch(err) {
		console.error(err);
		return;
	}

	let i=0;

	for(const image of images_set) {
		let stats;
		try {
			stats = await fs.promises.stat(image);
		} catch(err) {
			console.log('Unable to read file:', image);
			errors++;
			continue;
		}

		const size = stats.size,
			small = stats.size < 2048,
			large = stats.size > 256000;

		const promises = [];

		if ( use_pngcrush )
			promises.push(usePNGCrush(image, size, small, large));

		if ( use_optipng )
			promises.push(useOptipng(image, size, small, large));

		if ( use_pngout )
			promises.push(usePngout(image, size, small, large));

		if ( use_advpng )
			promises.push(useAdvpng(image, size, small, large));

		if ( use_zopfli )
			promises.push(useZopfli(image, size, small, large));

		const results = await Promise.all(promises);
		let smallest = null;

		for(const result of results) {
			if ( ! result[0] )
				continue;

			if ( ! smallest || result[1] < smallest[1] )
				smallest = result;
		}

		if ( smallest ) {
			sources[smallest[2]] = (sources[smallest[2]] || 0) + 1;
			saved += (stats.size - smallest[1]);
			processed++;

			await fs.promises.copyFile(smallest[3], image);
		}

		process.stdout.write('.');
	}

	process.stdout.write('\n');
	console.log('Complete.');
	console.log('');
	console.log(`Saved ${saved} bytes across ${processed} of ${images_set.size} images. ${errors} errors.`);
	console.log('Time:');
	console.log(`  ${Object.entries(time).map(x => `${x[0]}: ${Math.round(Number(x[1]) / 1000000) / 1000}s`).join(', ')}`);
	console.log(`Chosen:`);
	console.log(`  ${Object.entries(sources).map(x => `${x[0]}: ${x[1]}`).join(', ')}`);
}

main();