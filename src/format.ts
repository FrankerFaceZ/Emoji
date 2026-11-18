/*
The compact data format the FrankerFaceZ client downloads. See README.md for
the field-by-field description. This schema is the contract: the build output
and the committed baseline are both validated against it.
*/

import { Type, type Static } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';

import { ALL_STYLE_BITS } from './config.ts';
import { Findings } from './findings.ts';

const Key = Type.String({ pattern: '^[0-9a-f]{2,6}(-[0-9a-f]{2,6})*$' });
const Codes = Type.Union([Type.String({ minLength: 1 }), Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })]);
const Pos = Type.Tuple([Type.Integer({ minimum: 0 }), Type.Integer({ minimum: 0 })]);
const Images = Type.Integer({ minimum: 0, maximum: ALL_STYLE_BITS });
const Presentation = Type.Union([Type.Literal(0), Type.Literal(1)]);
const Tone = Type.Union([Type.Integer(), Type.Array(Type.Integer())]);

export const CompactVersion = Type.Tuple([Key, Pos, Images, Tone, Presentation, Codes]);

export const CompactEmoji = Type.Tuple([
	Type.Integer({ minimum: 0 }), // group
	Type.Number(), // order
	Codes,
	Type.Union([Type.String({ minLength: 1 }), Type.Literal(0)]), // name
	Key,
	Pos,
	Images,
	Type.Union([Type.Array(CompactVersion, { minItems: 1 }), Type.Literal(0)]),
	Presentation,
]);

export const CompactData = Type.Object({
	v: Type.Literal(3),
	n: Type.Integer({ minimum: 0 }),
	b: Type.Integer({ minimum: 0 }),
	t: Type.Integer({ minimum: 0 }),
	o: Type.Integer({ minimum: 0 }),
	/** Noto 3D image count. Added in v3.3. */
	d: Type.Optional(Type.Integer({ minimum: 0 })),
	c: Type.Record(Type.String({ pattern: '^[0-9]+$' }), Type.String()),
	e: Type.Array(CompactEmoji, { minItems: 1 }),
	/** Sprite sheet grid as [columns, rows]. Added in v3.3; the 2020 data (v3.2) is always 58x58. */
	g: Type.Optional(Type.Tuple([Type.Integer({ minimum: 1 }), Type.Integer({ minimum: 1 })])),
	/** Sprite sheet version. Sheets live at images/sheets/<s>/sheet-<style>-<size>.png. Added in v3.3. */
	s: Type.Optional(Type.String({ pattern: '^[0-9a-f]{8,64}$' })),
});

export type CompactData = Static<typeof CompactData>;
export type CompactEmoji = Static<typeof CompactEmoji>;
export type CompactVersion = Static<typeof CompactVersion>;
export type Pos = [number, number];

const compiled = TypeCompiler.Compile(CompactData);

export function validateCompact(value: unknown, label: string, findings: Findings): value is CompactData {
	if (compiled.Check(value))
		return true;
	const errors = [...compiled.Errors(value)].slice(0, 20).map(e => `${e.path || '/'}: ${e.message}`);
	findings.error('compact-schema', `${label} doesn't match the compact data format.`, errors);
	return false;
}

/** One sprite cell: an emoji or one of its skin tone versions. */
export interface Cell {
	key: string;
	/** Key of the base emoji, for skin tone versions. */
	parent: string | null;
	group: number;
	order: number;
	codes: string[];
	name: string | null;
	pos: Pos;
	images: number;
	type: 0 | 1;
	tone: number | number[] | null;
}

export function toCodes(codes: string | string[]): string[] {
	return Array.isArray(codes) ? codes : [codes];
}

export function fromCodes(codes: string[]): string | string[] {
	return codes.length === 1 ? codes[0]! : codes;
}

/** Flatten compact data into one entry per sprite cell, in file order. */
export function cells(data: CompactData): Cell[] {
	const out: Cell[] = [];
	for (const e of data.e) {
		const [group, order, codes, name, key, pos, images, versions, type] = e;
		out.push({ key, parent: null, group, order, codes: toCodes(codes), name: name || null, pos: [pos[0], pos[1]], images, type, tone: null });
		if (versions)
			for (const [vkey, vpos, vimages, tone, vtype, vcodes] of versions)
				out.push({ key: vkey, parent: key, group, order, codes: toCodes(vcodes), name: null, pos: [vpos[0], vpos[1]], images: vimages, type: vtype, tone });
	}
	return out;
}

/** Sprite grid of a data file. v3.2 files don't say; they were always square. */
export function gridOf(data: CompactData): [number, number] {
	if (data.g)
		return data.g;
	let size = 0;
	for (const cell of cells(data))
		size = Math.max(size, cell.pos[0] + 1, cell.pos[1] + 1);
	return [size, size];
}
