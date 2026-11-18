import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { ROOT } from './paths.ts';

export const exec = promisify(execFile);

export async function readJson<T = unknown>(file: string): Promise<T> {
	return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

export async function writeJson(file: string, value: unknown, pretty = true): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, JSON.stringify(value, null, pretty ? '\t' : undefined) + (pretty ? '\n' : ''), 'utf8');
}

export async function exists(file: string): Promise<boolean> {
	try {
		await fs.access(file);
		return true;
	} catch {
		return false;
	}
}

export function sha256(data: string | Uint8Array): string {
	return createHash('sha256').update(data).digest('hex');
}

/** Run `fn` over `items` with at most `limit` in flight. Results keep input order. */
export async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]!, i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

/** Read a file as it exists at a git ref. Returns null if the ref or file doesn't exist. */
export async function gitShow(ref: string, file: string): Promise<string | null> {
	const rel = path.relative(ROOT, file).replaceAll('\\', '/');
	try {
		const { stdout } = await exec('git', ['show', `${ref}:${rel}`], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
		return stdout;
	} catch {
		return null;
	}
}

export function fail(message: string): never {
	console.error(`\nError: ${message}`);
	process.exit(1);
}

export function parseArgs(argv = process.argv.slice(2)) {
	const flags = new Map<string, string | true>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (!arg.startsWith('--'))
			continue;
		const eq = arg.indexOf('=');
		if (eq !== -1)
			flags.set(arg.slice(2, eq), arg.slice(eq + 1));
		else if (argv[i + 1] && !argv[i + 1]!.startsWith('--'))
			flags.set(arg.slice(2), argv[++i]!);
		else
			flags.set(arg.slice(2), true);
	}
	return {
		has: (name: string) => flags.has(name),
		get: (name: string) => {
			const v = flags.get(name);
			return typeof v === 'string' ? v : undefined;
		},
	};
}

export const isCI = !!process.env.CI;

/** Append to the GitHub Actions job summary, when running there. */
export async function jobSummary(markdown: string): Promise<void> {
	const file = process.env.GITHUB_STEP_SUMMARY;
	if (file)
		await fs.appendFile(file, markdown + '\n', 'utf8');
}

/** Set a GitHub Actions step output, when running there. */
export async function setOutput(name: string, value: string): Promise<void> {
	const file = process.env.GITHUB_OUTPUT;
	if (file)
		await fs.appendFile(file, `${name}=${value}\n`, 'utf8');
}
