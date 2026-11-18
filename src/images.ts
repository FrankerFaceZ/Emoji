/*
Image output: individual 72x72 PNGs (and SVGs) per style, plus one sprite
sheet per style and size.

Sheets are assembled by copying raw RGBA tiles into one buffer and encoding it
once. (sharp's composite() with ~4000 overlays took up to a minute per sheet;
this takes a couple of seconds.)
*/

import fs from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { IMAGE_SIZE, SHEET_KERNEL, SHEET_PADDING, SHEET_SIZES, STYLES, type StyleDef, type StyleId } from './config.ts';
import { cells, type Cell, type CompactData } from './format.ts';
import { canonical, parseCodepoints } from './keys.ts';
import type { ImageFiles, SourceIndex } from './sources.ts';
import type { ImageSetId } from './config.ts';
import { pool } from './util.ts';

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const TILE_BYTES = IMAGE_SIZE * IMAGE_SIZE * 4;

export function sheetPath(root: string, version: string, style: StyleId, size: number): string {
	return path.join(root, 'sheets', version, `sheet-${style}-${size}.png`);
}

export function sheetDims(grid: readonly [number, number], size: number): [number, number] {
	const cell = size + SHEET_PADDING * 2;
	return [grid[0] * cell, grid[1] * cell];
}

/** Pixels under full transparency carry no information; zeroing them makes sheets compress better and comparisons exact. */
export function clearTransparent(rgba: Buffer): Buffer {
	for (let i = 0; i < rgba.length; i += 4)
		if (rgba[i + 3] === 0) {
			rgba[i] = 0;
			rgba[i + 1] = 0;
			rgba[i + 2] = 0;
		}
	return rgba;
}

/** Decode any image to IMAGE_SIZE x IMAGE_SIZE RGBA. */
export async function toTile(input: string | Buffer, size = IMAGE_SIZE, raw = false, kernel: 'lanczos3' | 'mitchell' = 'lanczos3'): Promise<Buffer> {
	const img = raw
		? sharp(input, { raw: { width: IMAGE_SIZE, height: IMAGE_SIZE, channels: 4 } })
		: sharp(input).toColourspace('srgb').ensureAlpha();
	const data = await img
		.resize(size, size, { fit: 'contain', background: TRANSPARENT, kernel })
		.raw()
		.toBuffer();
	if (data.length !== size * size * 4)
		throw new Error(`Unexpected tile size ${data.length} for ${typeof input === 'string' ? input : 'buffer'}`);
	return clearTransparent(data);
}

/** Resolve which source files a style uses for a cell, including the style's fallback. */
export function filesFor(style: StyleDef, cell: Cell, indexes: Record<ImageSetId, SourceIndex>): ImageFiles | null {
	const canon = canonical(parseCodepoints(cell.key));
	if (cell.images & style.bit)
		return indexes[style.set].files.get(canon) ?? null;
	if (style.fallback) {
		const fb = STYLES.find(s => s.id === style.fallback)!;
		if (cell.images & fb.bit)
			return indexes[fb.set].files.get(canon) ?? null;
	}
	return null;
}

export interface StyleOutput {
	style: StyleId;
	singles: number;
	svgs: number;
	resized: number;
	sheets: string[];
}

/**
Write the singles and sheets for one style. Singles that are already
72x72 RGBA PNGs are copied byte for byte; anything else is resized.
*/
export async function buildStyle(style: StyleDef, data: CompactData, indexes: Record<ImageSetId, SourceIndex>, outDir: string): Promise<StyleOutput> {
	const list = cells(data);
	const dir = path.join(outDir, style.id);
	await fs.mkdir(dir, { recursive: true });

	const tiles = new Array<Buffer | null>(list.length).fill(null);
	let singles = 0, svgs = 0, resized = 0;

	await pool(list, 32, async (cell, i) => {
		const files = filesFor(style, cell, indexes);
		if (!files?.image) {
			if (cell.images & style.bit)
				throw new Error(`${style.id}: ${cell.key} is marked as having an image, but no file was found.`);
			return;
		}

		const meta = await sharp(files.image).metadata();
		const out = path.join(dir, `${cell.key}.png`);
		if (meta.format === 'png' && meta.width === IMAGE_SIZE && meta.height === IMAGE_SIZE && meta.channels === 4) {
			await fs.copyFile(files.image, out);
			tiles[i] = clearTransparent(await sharp(files.image).raw().toBuffer());
		} else {
			// Anything else (other sizes, or SVG, which librsvg draws at the target size) goes through sharp.
			const tile = await toTile(files.image);
			await sharp(tile, { raw: { width: IMAGE_SIZE, height: IMAGE_SIZE, channels: 4 } }).png().toFile(out);
			tiles[i] = tile;
			resized++;
		}
		if (tiles[i]!.length !== TILE_BYTES)
			throw new Error(`${style.id}: ${cell.key} decoded to ${tiles[i]!.length} bytes`);
		singles++;

		if (style.svg && files.svg) {
			await fs.copyFile(files.svg, path.join(dir, `${cell.key}.svg`));
			svgs++;
		}
	});

	const grid = data.g!;
	const sheets: string[] = [];
	for (const size of SHEET_SIZES) {
		const [width, height] = sheetDims(grid, size);
		const cellSize = size + SHEET_PADDING * 2;
		const sheet = Buffer.alloc(width * height * 4);

		await pool(list, 32, async (cell, i) => {
			const tile = tiles[i];
			if (!tile)
				return;
			const px = size === IMAGE_SIZE ? tile : await toTile(tile, size, true, SHEET_KERNEL);
			const x = cell.pos[0] * cellSize + SHEET_PADDING;
			const y = cell.pos[1] * cellSize + SHEET_PADDING;
			for (let row = 0; row < size; row++)
				px.copy(sheet, ((y + row) * width + x) * 4, row * size * 4, (row + 1) * size * 4);
		});

		const file = sheetPath(outDir, data.s!, style.id, size);
		await fs.mkdir(path.dirname(file), { recursive: true });
		await sharp(sheet, { raw: { width, height, channels: 4 }, limitInputPixels: false })
			.png({ compressionLevel: 9, adaptiveFiltering: true })
			.toFile(file);
		sheets.push(file);
	}

	return { style: style.id, singles, svgs, resized, sheets };
}
