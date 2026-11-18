/*
pnpm sources:check: look for newer upstream releases.

  --write            update sources.json / package.json to the latest versions
  --summary <file>   write a markdown summary of what changed (for the PR body)

Reads $GITHUB_TOKEN if set (avoids API rate limits). Sets the GitHub Actions
outputs `changed` and `problems`.
*/

import fs from 'node:fs/promises';
import path from 'node:path';

import type { SourceId } from '../config.ts';
import { PACKAGE_FILE, SOURCES_FILE } from '../paths.ts';
import { loadSources, type Source } from '../sources.ts';
import { parseArgs, readJson, setOutput, sha256, writeJson } from '../util.ts';

const args = parseArgs();
const token = process.env.GITHUB_TOKEN;

interface Release {
	tag_name: string;
	html_url: string;
	published_at: string;
	assets: { name: string, digest?: string | null, browser_download_url: string }[];
}

async function github<T>(endpoint: string): Promise<T> {
	const res = await fetch(`https://api.github.com${endpoint}`, {
		headers: {
			accept: 'application/vnd.github+json',
			'user-agent': 'ffz-emoji-update-check',
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
	});
	if (!res.ok)
		throw new Error(`GitHub ${endpoint}: ${res.status} ${res.statusText}`);
	return await res.json() as T;
}

const sources = await loadSources();
const pkg = await readJson<{ dependencies: Record<string, string> }>(PACKAGE_FILE);
const changes: string[] = [];
const problems: string[] = [];
const next = structuredClone(sources);

for (const id of Object.keys(sources) as SourceId[]) {
	const src: Source = sources[id];
	if (src.kind === 'release' && src.frozen) {
		console.log(`${id}: frozen at ${src.ref}, skipped`);
		continue;
	}

	let latest: Release;
	try {
		latest = await github<Release>(`/repos/${src.repo}/releases/latest`);
	} catch (err) {
		problems.push(`${id}: couldn't read the latest release of ${src.repo}: ${String(err)}`);
		continue;
	}

	if (latest.tag_name === src.ref) {
		console.log(`${id}: ${src.ref} is current`);
		continue;
	}

	console.log(`${id}: ${src.ref} -> ${latest.tag_name}`);

	if (src.kind === 'git') {
		const commit = await github<{ sha: string }>(`/repos/${src.repo}/commits/${encodeURIComponent(latest.tag_name)}`);
		const updated = { ...src, ref: latest.tag_name, commit: commit.sha };

		// Noto tags look like v2026-09-24-unicode18_0. Use the matching CDN version if Google serves it.
		const unicode = /unicode(\d+)_(\d+)/.exec(latest.tag_name);
		if (id === 'noto' && unicode) {
			const version = `${unicode[1]}.${unicode[2]}`;
			const probe = await fetch(`https://fonts.gstatic.com/s/e/notoemoji/${version}/1f600/72.png`, { method: 'HEAD' });
			if (probe.ok)
				updated.gstatic = version;
			else
				problems.push(`noto: fonts.gstatic.com has no ${version} yet. Flags stay on ${src.gstatic}.`);
		}
		next[id] = updated;
	} else {
		const assets: Record<string, string> = {};
		for (const name of Object.keys(src.assets)) {
			const asset = latest.assets.find(a => a.name === name);
			if (!asset) {
				problems.push(`${id}: release ${latest.tag_name} has no asset named "${name}". Upstream changed how it publishes images; update IMAGE_SETS and sources.json by hand. Assets: ${latest.assets.map(a => a.name).join(', ')}`);
				continue;
			}
			let digest = asset.digest ?? null;
			if (!digest) {
				const res = await fetch(asset.browser_download_url);
				digest = `sha256:${sha256(new Uint8Array(await res.arrayBuffer()))}`;
			}
			assets[name] = digest;
		}
		if (Object.keys(assets).length !== Object.keys(src.assets).length)
			continue;
		next[id] = { ...src, ref: latest.tag_name, assets };
	}

	changes.push(`- **${id}**: \`${src.ref}\` → [\`${latest.tag_name}\`](${latest.html_url}) (${latest.published_at.slice(0, 10)})`);
}

// emojibase-data comes from npm.
const npm = await fetch('https://registry.npmjs.org/emojibase-data/latest');
if (npm.ok) {
	const { version } = await npm.json() as { version: string };
	const current = pkg.dependencies['emojibase-data'];
	if (current !== version) {
		console.log(`emojibase-data: ${current} -> ${version}`);
		changes.push(`- **emojibase-data**: \`${current}\` → [\`${version}\`](https://github.com/milesj/emojibase/releases/tag/emojibase-data%40${version})`);
		pkg.dependencies['emojibase-data'] = version;
		pkg.dependencies['emojibase'] = version;
	} else
		console.log(`emojibase-data: ${current} is current`);
} else
	problems.push(`emojibase-data: npm registry returned ${npm.status}`);

if (args.has('write') && changes.length) {
	await writeJson(SOURCES_FILE, next);
	await writeJson(PACKAGE_FILE, pkg);
	console.log('\nUpdated sources.json and package.json. Run "pnpm install" to update the lockfile.');
}

const summary = [
	changes.length ? '### Upstream updates\n\n' + changes.join('\n') : 'No upstream updates.',
	problems.length ? '\n### Needs attention\n\n' + problems.map(p => `- ${p}`).join('\n') : '',
].join('\n');

const summaryFile = args.get('summary');
if (summaryFile) {
	await fs.mkdir(path.dirname(path.resolve(summaryFile)), { recursive: true });
	await fs.writeFile(summaryFile, summary + '\n', 'utf8');
}
for (const p of problems)
	console.warn(`! ${p}`);

await setOutput('changed', changes.length ? 'true' : 'false');
await setOutput('problems', problems.length ? 'true' : 'false');
