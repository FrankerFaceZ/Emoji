/*
shipped.json: the record of what we've published, kept in git the way a
package lockfile is. One line per emoji (skin tone versions included), sorted
by key, with its shortcodes in order, its category, its presentation type, and
which styles have an image.

The build reads it to keep every shortcode that ever shipped (see
shortcodes.ts), and the checks compare a new build against it, so nothing
disappears without an allow.json entry. A pull request's diff of this file is
the readable summary of what changed. Everything else the build makes lives
in dist/ and in the GitHub release, never in git.
*/

import { Type } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';

import { Findings } from './findings.ts';
import { cells, validateCompact, type CompactData } from './format.ts';
import { LEGACY_COMPACT_FILE, SHIPPED_FILE } from './paths.ts';
import { gitShow } from './util.ts';

export interface ShippedEntry {
	codes: string[];
	group: number;
	images: number;
	type: 0 | 1;
}

/** Key => entry */
export type Shipped = Map<string, ShippedEntry>;

const Entry = Type.Object({
	codes: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	group: Type.Integer({ minimum: 0 }),
	images: Type.Integer({ minimum: 0 }),
	type: Type.Union([Type.Literal(0), Type.Literal(1)]),
}, { additionalProperties: false });

const ShippedSchema = TypeCompiler.Compile(Type.Record(
	Type.String({ pattern: '^[0-9a-f]{2,6}(-[0-9a-f]{2,6})*$' }),
	Entry,
));

export function shippedFromCompact(data: CompactData): Shipped {
	const out: Shipped = new Map();
	for (const cell of cells(data))
		out.set(cell.key, { codes: cell.codes, group: cell.group, images: cell.images, type: cell.type });
	return out;
}

/** One sorted line per emoji, so diffs show exactly the emoji that changed. */
export function serializeShipped(shipped: Shipped): string {
	const keys = [...shipped.keys()].sort();
	const lines = keys.map(key => {
		const e = shipped.get(key)!;
		// Fixed field order, so the text only changes when the data does.
		return `\t${JSON.stringify(key)}: ${JSON.stringify({ codes: e.codes, group: e.group, images: e.images, type: e.type })}`;
	});
	return `{\n${lines.join(',\n')}\n}\n`;
}

export function parseShipped(text: string, label: string, findings: Findings): Shipped | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		findings.error('shipped-schema', `${label} isn't valid JSON.`, [String(err)]);
		return null;
	}
	if (!ShippedSchema.Check(raw)) {
		const errors = [...ShippedSchema.Errors(raw)].slice(0, 20).map(e => `${e.path || '/'}: ${e.message}`);
		findings.error('shipped-schema', `${label} doesn't match the shipped.json format.`, errors);
		return null;
	}
	return new Map(Object.entries(raw as Record<string, ShippedEntry>));
}

/**
What had shipped as of a git ref ('' means the git index). Before shipped.json
existed, the repository kept the 2020 build's emoji-compact.json, so that is
read instead when a ref has no shipped.json.
*/
export async function loadShippedAt(ref: string, findings: Findings): Promise<{ shipped: Shipped, label: string } | null> {
	const text = await gitShow(ref, SHIPPED_FILE);
	if (text !== null) {
		const label = `${ref}:shipped.json`;
		const shipped = parseShipped(text, label, findings);
		return shipped ? { shipped, label } : null;
	}

	const legacy = await gitShow(ref, LEGACY_COMPACT_FILE);
	if (legacy !== null) {
		const label = `${ref}:emoji-compact.json (2020 format)`;
		const data: unknown = JSON.parse(legacy);
		if (!validateCompact(data, label, findings))
			return null;
		return { shipped: shippedFromCompact(data), label };
	}

	return null;
}

/** Image counts per style bit, for the report. */
export function countImages(shipped: Shipped, bit: number): number {
	let n = 0;
	for (const e of shipped.values())
		if (e.images & bit)
			n++;
	return n;
}
