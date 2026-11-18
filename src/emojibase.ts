/*
Load emojibase-data and validate it against the shape our build relies on.

Emojibase has changed its format under us before: v6/v7 removed `name` and
`shortcodes` from data.json and started listing the regional indicators. The
2023 rebuild didn't notice and silently shipped no names and duplicate keys.
These schemas make that kind of change fail loudly instead.
*/

import { createRequire } from 'node:module';

import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';

import { SHORTCODE_SETS } from './config.ts';
import { Findings } from './findings.ts';
import { readJson } from './util.ts';

const require = createRequire(import.meta.url);

const Hex = Type.String({ pattern: '^[0-9A-F]{2,6}(-[0-9A-F]{2,6})*$' });
const ToneValue = Type.Integer({ minimum: 1, maximum: 5 });
const PresentationType = Type.Union([Type.Literal(0), Type.Literal(1)]);

const Skin = Type.Object({
	hexcode: Hex,
	label: Type.String({ minLength: 1 }),
	type: PresentationType,
	tone: Type.Union([ToneValue, Type.Array(ToneValue, { minItems: 1 })]),
	group: Type.Optional(Type.Integer({ minimum: 0 })),
	order: Type.Optional(Type.Number()),
	version: Type.Number(),
});

const Emoji = Type.Object({
	hexcode: Hex,
	label: Type.String({ minLength: 1 }),
	emoji: Type.String({ minLength: 1 }),
	type: PresentationType,
	version: Type.Number(),
	group: Type.Optional(Type.Integer({ minimum: 0 })),
	order: Type.Optional(Type.Number()),
	skins: Type.Optional(Type.Array(Skin, { minItems: 1 })),
});

export const EmojiData = Type.Array(Emoji, { minItems: 1500 });

export const Groups = Type.Object({
	groups: Type.Record(Type.String({ pattern: '^[0-9]+$' }), Type.String({ pattern: '^[a-z-]+$' })),
});

export const Shortcodes = Type.Record(Hex, Type.Union([
	Type.String({ minLength: 1 }),
	Type.Array(Type.String({ minLength: 1 })),
]));

export const UnicodeNames = Type.Record(Hex, Type.String({ minLength: 1 }));

export type EmojibaseEmoji = Static<typeof Emoji>;
export type EmojibaseSkin = Static<typeof Skin>;
export type ShortcodeMap = Static<typeof Shortcodes>;

/** Fields we know about. New ones are reported (not failed) so format drift is visible. */
const KNOWN_EMOJI_FIELDS = new Set(['label', 'hexcode', 'emoji', 'text', 'type', 'version', 'tags', 'order', 'group', 'subgroup', 'emoticon', 'skins', 'gender', 'tone']);

export interface Emojibase {
	version: string;
	data: EmojibaseEmoji[];
	groups: Record<string, string>;
	names: Record<string, string>;
	shortcodes: { name: string, dashes: boolean, codes: ShortcodeMap }[];
}

function validate<T extends TSchema>(schema: T, value: unknown, label: string, findings: Findings): value is Static<T> {
	const check = TypeCompiler.Compile(schema);
	if (check.Check(value))
		return true;

	const errors = [...check.Errors(value)].slice(0, 20).map(e => `${e.path || '/'}: ${e.message}`);
	findings.error('input-schema', `${label} doesn't match the expected format. The upstream format probably changed.`, errors);
	return false;
}

export async function loadEmojibase(findings: Findings): Promise<Emojibase | null> {
	const pkg = await readJson<{ version: string }>(require.resolve('emojibase-data/package.json'));
	const data = await readJson(require.resolve('emojibase-data/en/data.json'));
	const groups = await readJson(require.resolve('emojibase-data/meta/groups.json'));
	const names = await readJson(require.resolve('emojibase-data/meta/unicode-names.json'));

	let ok = validate(EmojiData, data, 'emojibase-data/en/data.json', findings);
	ok = validate(Groups, groups, 'emojibase-data/meta/groups.json', findings) && ok;
	ok = validate(UnicodeNames, names, 'emojibase-data/meta/unicode-names.json', findings) && ok;

	const shortcodes: Emojibase['shortcodes'] = [];
	for (const set of SHORTCODE_SETS) {
		let codes: unknown;
		try {
			codes = await readJson(require.resolve(`emojibase-data/en/shortcodes/${set.name}.json`));
		} catch (err) {
			findings.error('input-missing', `Shortcode set "${set.name}" is missing from emojibase-data.`, [String(err)]);
			ok = false;
			continue;
		}
		if (validate(Shortcodes, codes, `emojibase-data/en/shortcodes/${set.name}.json`, findings))
			shortcodes.push({ name: set.name, dashes: set.dashes, codes });
		else
			ok = false;
	}

	if (!ok)
		return null;

	const typed = data as EmojibaseEmoji[];

	const unknown = new Set<string>();
	for (const emoji of typed) {
		for (const key of Object.keys(emoji))
			if (!KNOWN_EMOJI_FIELDS.has(key))
				unknown.add(key);
		for (const skin of emoji.skins ?? [])
			for (const key of Object.keys(skin))
				if (!KNOWN_EMOJI_FIELDS.has(key))
					unknown.add(key);
	}
	if (unknown.size)
		findings.warn('input-new-fields', 'emojibase-data has fields we have never seen. Check whether they change the meaning of the fields we use.', unknown);

	// Names should cover every emoji. Missing names mean the names file moved or changed format.
	let unnamed = 0;
	for (const emoji of typed) {
		if (!(names as Record<string, string>)[emoji.hexcode])
			unnamed++;
	}
	if (unnamed > typed.length * 0.05)
		findings.error('input-names', `${unnamed} of ${typed.length} emoji have no Unicode name in meta/unicode-names.json.`);

	return {
		version: pkg.version,
		data: typed,
		groups: (groups as Static<typeof Groups>).groups,
		names: names as Record<string, string>,
		shortcodes,
	};
}
