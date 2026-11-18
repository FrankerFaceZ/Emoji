/*
pnpm tools: download the pinned oxipng for this platform into .cache/tools.
*/

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { unzipSync } from 'fflate';

import { TOOLS_DIR } from '../paths.ts';
import { OXIPNG_ASSETS, OXIPNG_LOCAL, OXIPNG_VERSION, ensureToolsDir, findOxipng } from '../tools.ts';
import { exec, fail, sha256 } from '../util.ts';

const platform = `${process.platform}-${process.arch}`;
const entry = OXIPNG_ASSETS[platform];
if (!entry)
	fail(`No pinned oxipng build for ${platform}. Install oxipng ${OXIPNG_VERSION} yourself and put it on PATH, or set $OXIPNG.`);

const existing = await findOxipng();
if (existing?.bin === OXIPNG_LOCAL && existing.version.includes(OXIPNG_VERSION)) {
	console.log(`${existing.version} is already installed at ${OXIPNG_LOCAL}`);
	process.exit(0);
}

const url = `https://github.com/shssoichiro/oxipng/releases/download/v${OXIPNG_VERSION}/${entry.asset}`;
console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok)
	fail(`GET ${url}: ${res.status}`);
const data = new Uint8Array(await res.arrayBuffer());
const digest = sha256(data);
if (digest !== entry.sha256)
	fail(`${entry.asset} has sha256 ${digest}, expected ${entry.sha256}`);

await ensureToolsDir();
const binName = path.basename(OXIPNG_LOCAL);

if (entry.asset.endsWith('.zip')) {
	const files = unzipSync(data, { filter: f => path.posix.basename(f.name) === binName });
	const found = Object.values(files)[0];
	if (!found)
		fail(`${entry.asset} doesn't contain ${binName}`);
	await fs.writeFile(OXIPNG_LOCAL, found);
} else {
	const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'oxipng-'));
	try {
		const archive = path.join(tmp, entry.asset);
		await fs.writeFile(archive, data);
		await exec('tar', ['-xzf', archive, '-C', tmp]);
		const dir = path.join(tmp, entry.asset.replace(/\.tar\.gz$/, ''));
		await fs.copyFile(path.join(dir, binName), OXIPNG_LOCAL);
		await fs.chmod(OXIPNG_LOCAL, 0o755);
	} finally {
		await fs.rm(tmp, { recursive: true, force: true });
	}
}

const installed = await findOxipng();
if (installed?.bin !== OXIPNG_LOCAL)
	fail(`Installed ${OXIPNG_LOCAL}, but it doesn't run.`);
console.log(`Installed ${installed.version} to ${path.relative(process.cwd(), TOOLS_DIR)}`);
