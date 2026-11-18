/*
Shortcode assignment.

Rules, in order:
1. Every shortcode that already shipped stays on the same emoji, in the same
   order, so nobody's typed `:codes:` break and the primary name (shown in
   tooltips) doesn't change. Upstream renames don't touch these. Removing one
   takes an entry in allow.json ("dropShortcodes").
2. Then codes from each emojibase shortcode set, in SHORTCODE_SETS order. A code
   already owned by another emoji is skipped and reported.
3. New emoji get their codes sorted by similarity to their label, like the
   2020 scripts did, so the most descriptive code comes first.
*/

import { distance } from 'fastest-levenshtein';

import { SHORTCODE_PATTERN } from './config.ts';
import type { ShortcodeMap } from './emojibase.ts';
import { Findings } from './findings.ts';

export interface ShortcodeTarget {
	key: string;
	hexcode: string;
	label: string;
}

export interface ShortcodeSet {
	name: string;
	dashes: boolean;
	codes: ShortcodeMap;
}

export function normalizeCode(code: string, dashes: boolean): string {
	const lower = code.toLowerCase();
	return dashes ? lower.replace(/-/g, '_') : lower;
}

export function assignShortcodes(
	targets: readonly ShortcodeTarget[],
	sets: readonly ShortcodeSet[],
	previous: ReadonlyMap<string, readonly string[]>,
	drop: ReadonlySet<string>,
	findings: Findings,
): Map<string, string[]> {
	const owner = new Map<string, string>();
	const out = new Map<string, string[]>();
	const collisions: string[] = [];
	const invalid: string[] = [];

	const claim = (key: string, code: string, source: string): boolean => {
		if (drop.has(code))
			return false;
		if (!SHORTCODE_PATTERN.test(code)) {
			invalid.push(`${code} (${source})`);
			return false;
		}
		const current = owner.get(code);
		if (current === key)
			return false;
		if (current) {
			collisions.push(`${code}: ${current} keeps it, ${key} (${source}) skipped`);
			return false;
		}
		owner.set(code, key);
		out.get(key)!.push(code);
		return true;
	};

	for (const t of targets)
		out.set(t.key, []);

	// 1. Carry forward everything that shipped.
	for (const t of targets)
		for (const code of previous.get(t.key) ?? [])
			claim(t.key, code, 'previous');

	// 2. Upstream sets.
	for (const set of sets)
		for (const t of targets) {
			const raw = set.codes[t.hexcode];
			if (!raw)
				continue;
			for (const code of Array.isArray(raw) ? raw : [raw])
				claim(t.key, normalizeCode(code, set.dashes), set.name);
		}

	// 3. Order codes for emoji that never shipped.
	for (const t of targets) {
		if (previous.has(t.key))
			continue;
		const codes = out.get(t.key)!;
		const test = t.label.toLowerCase().replace(/ /g, '_');
		codes.sort((a, b) => distance(test, a) - distance(test, b) || a.localeCompare(b));
	}

	// Every emoji needs at least one shortcode; the client uses the first one as its name.
	const fallback: string[] = [];
	for (const t of targets) {
		const codes = out.get(t.key)!;
		if (codes.length)
			continue;
		const base = t.label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9+-]+/g, '_').replace(/^_+|_+$/g, '') || t.key.replace(/-/g, '_');
		let code = base;
		for (let i = 2; owner.has(code); i++)
			code = `${base}_${i}`;
		claim(t.key, code, 'label');
		fallback.push(`${t.key} => ${code}`);
	}

	if (collisions.length)
		findings.info('shortcode-collision', `${collisions.length} upstream shortcodes were skipped because another emoji already has them.`, collisions);
	if (invalid.length)
		findings.warn('shortcode-invalid', `${invalid.length} upstream shortcodes have characters we don't allow and were skipped.`, invalid);
	if (fallback.length)
		findings.warn('shortcode-fallback', `${fallback.length} emoji have no shortcode in any set. A code was made from the label.`, fallback);

	return out;
}
