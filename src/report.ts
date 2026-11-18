/*
Markdown report (job summary / PR body) and a preview image of new emoji.
*/

import fs from 'node:fs/promises';
import path from 'node:path';

import sharp, { type OverlayOptions } from 'sharp';

import { IMAGE_SIZE, STYLES } from './config.ts';
import type { Finding, Findings } from './findings.ts';
import { cells, type Cell, type CompactData } from './format.ts';
import { countImages, type Shipped } from './shipped.ts';

const MAX_ITEMS = 40;

function block(f: Finding): string {
	let out = `- **${f.message}** \`${f.code}\``;
	if (f.items) {
		const shown = f.items.slice(0, MAX_ITEMS).map(i => `\`${i}\``).join(', ');
		const more = f.items.length > MAX_ITEMS ? `, and ${f.items.length - MAX_ITEMS} more` : '';
		out += `\n  <details><summary>${f.items.length} items</summary>\n\n  ${shown}${more}\n  </details>`;
	}
	return out;
}

export interface ReportInput {
	title: string;
	findings: Findings;
	data: CompactData;
	baseline: Shipped | null;
	baselineLabel: string;
	sheets?: Record<string, { bytes: number }>;
	versions: Record<string, string>;
}

export function renderReport(input: ReportInput): string {
	const { findings, data, baseline } = input;
	const errors = findings.errors, warnings = findings.warnings;
	const info = findings.list.filter(f => f.level === 'info');
	const status = errors.length ? `❌ ${errors.length} error${errors.length === 1 ? '' : 's'}` : warnings.length ? `⚠️ passed with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : '✅ passed';

	const lines: string[] = [`## ${input.title}`, '', `**Checks:** ${status} (compared with ${input.baselineLabel})`, ''];

	lines.push('| Source | Version |', '| --- | --- |');
	for (const [name, version] of Object.entries(input.versions))
		lines.push(`| ${name} | \`${version}\` |`);
	lines.push('');

	lines.push('| | Before | After |', '| --- | ---: | ---: |');
	lines.push(`| Emoji (with skin tones) | ${baseline ? baseline.size : '-'} | ${cells(data).length} |`);
	for (const style of STYLES)
		lines.push(`| ${style.id} images | ${baseline ? countImages(baseline, style.bit) : '-'} | ${data[style.counter] ?? '-'} |`);
	lines.push(`| Sprite grid | | ${data.g?.join('x')} |`);
	lines.push(`| \`v3.3.json\` | | ${(JSON.stringify(data).length / 1024).toFixed(0)} KB |`);
	lines.push('');

	if (input.sheets) {
		lines.push('<details><summary>Sprite sheets</summary>', '', '| File | Size |', '| --- | ---: |');
		for (const [file, s] of Object.entries(input.sheets))
			lines.push(`| \`${file}\` | ${(s.bytes / 1024).toFixed(0)} KB |`);
		lines.push('', '</details>', '');
	}

	if (errors.length)
		lines.push('### Errors', '', ...errors.map(block), '');
	if (warnings.length)
		lines.push('### Warnings', '', ...warnings.map(block), '');
	if (info.length)
		lines.push('### Changes', '', ...info.map(block), '');

	return lines.join('\n');
}

/**
One row of tiles per emoji, one column per style, so new emoji can be eyeballed
in every style at once. Missing images are left blank.
*/
export async function renderPreview(list: Cell[], imagesRoot: string, file: string, perRow = 6): Promise<boolean> {
	if (!list.length)
		return false;
	const gap = 4, group = STYLES.length * (IMAGE_SIZE + gap) + 12;
	const rows = Math.ceil(list.length / perRow);
	const width = perRow * group, height = rows * (IMAGE_SIZE + gap * 2);
	const composites: OverlayOptions[] = [];
	for (const [i, cell] of list.entries()) {
		const gx = (i % perRow) * group, gy = Math.floor(i / perRow) * (IMAGE_SIZE + gap * 2) + gap;
		for (const [s, style] of STYLES.entries()) {
			const img = path.join(imagesRoot, style.id, `${cell.key}.png`);
			try {
				await fs.access(img);
				composites.push({ input: img, left: gx + s * (IMAGE_SIZE + gap), top: gy });
			} catch {
				// No image for this style.
			}
		}
	}
	await fs.mkdir(path.dirname(file), { recursive: true });
	await sharp({ create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
		.composite(composites)
		.png()
		.toFile(file);
	return true;
}
