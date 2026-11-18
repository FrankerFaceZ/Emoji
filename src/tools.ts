/*
External tools. Only oxipng: sharp (libvips) does everything else in-process,
which replaces ImageMagick, pngcrush, optipng, advpng, pngout, and zopflipng.

`pnpm tools` downloads a pinned oxipng release for the current platform into
.cache/tools and verifies its sha256. An oxipng on PATH (or $OXIPNG) works too.
*/

import fs from 'node:fs/promises';
import path from 'node:path';

import { TOOLS_DIR } from './paths.ts';
import { exec, exists } from './util.ts';

export const OXIPNG_VERSION = '10.2.1';

/** Release asset + sha256 per platform, from https://github.com/shssoichiro/oxipng/releases */
export const OXIPNG_ASSETS: Record<string, { asset: string, sha256: string }> = {
	'linux-x64': { asset: `oxipng-${OXIPNG_VERSION}-x86_64-unknown-linux-musl.tar.gz`, sha256: '1813750ef592c5350ca79c88f98b2c0876d05c826dc7156245256d4255c1ad17' },
	'linux-arm64': { asset: `oxipng-${OXIPNG_VERSION}-aarch64-unknown-linux-musl.tar.gz`, sha256: 'ff21aa2a005b324c8dfbdf13cd2f469fb6728b27dacded82635824ecd12e3b35' },
	'darwin-x64': { asset: `oxipng-${OXIPNG_VERSION}-x86_64-apple-darwin.tar.gz`, sha256: '111883bbe42b25e01cb1ca41f39f8094e4830b173f0e42be342ecc4ca48f3131' },
	'darwin-arm64': { asset: `oxipng-${OXIPNG_VERSION}-aarch64-apple-darwin.tar.gz`, sha256: '7039fcfc78e8aa1ed2b57d848057a0296f082e92b3e1807ac65402d10d926764' },
	'win32-x64': { asset: `oxipng-${OXIPNG_VERSION}-x86_64-pc-windows-msvc.zip`, sha256: '7e940f83ee46874b73f53031f96a15834cb70b220af27391fb06fe7b4dd798e1' },
};

export const OXIPNG_LOCAL = path.join(TOOLS_DIR, process.platform === 'win32' ? 'oxipng.exe' : 'oxipng');

async function works(bin: string): Promise<string | null> {
	try {
		const { stdout } = await exec(bin, ['--version']);
		return stdout.trim();
	} catch {
		return null;
	}
}

/** Find a working oxipng. Returns its path and version, or null. */
export async function findOxipng(): Promise<{ bin: string, version: string } | null> {
	const candidates = [process.env.OXIPNG, OXIPNG_LOCAL, 'oxipng'].filter((x): x is string => !!x);
	for (const bin of candidates) {
		if (bin !== 'oxipng' && !await exists(bin))
			continue;
		const version = await works(bin);
		if (version)
			return { bin, version };
	}
	return null;
}

/**
Losslessly optimize PNGs in place. Paths may be files or folders (searched
recursively). oxipng spreads the work across all cores.
*/
export async function oxipng(bin: string, paths: string[]): Promise<void> {
	await exec(bin, ['--opt', '4', '--strip', 'safe', '--quiet', '--recursive', ...paths], { maxBuffer: 64 * 1024 * 1024 });
}

export async function ensureToolsDir() {
	await fs.mkdir(TOOLS_DIR, { recursive: true });
}
