/*
Every image source names its files differently:

  emojibase   1F636-200D-1F32B-FE0F   (FE0F dropped for single code points)
  twemoji     1f636-200d-1f32b        (lower case, FE0F mostly dropped, no zero padding)
  noto/blob   emoji_u1f636_200d_1f32b (underscores, FE0F always dropped, 4 digit padding)
  openmoji    1F636-200D-1F32B-FE0F   (upper case, FE0F kept)

We match them all through a canonical form: lower case hex, no zero padding,
no FE0F, joined with '-'. FE0F never distinguishes two different emoji in the
fully-qualified set, and a check makes sure that stays true.
*/

const VS16 = 0xFE0F;

export function parseCodepoints(hex: string, separator: string | RegExp = /[-_ ]/): number[] {
	const out: number[] = [];
	for (const part of hex.split(separator)) {
		if (!part)
			continue;
		const cp = Number.parseInt(part, 16);
		if (!Number.isFinite(cp) || cp < 0 || cp > 0x10FFFF || !/^[0-9a-f]+$/i.test(part))
			throw new Error(`Invalid code point "${part}" in "${hex}"`);
		out.push(cp);
	}
	if (!out.length)
		throw new Error(`No code points in "${hex}"`);
	return out;
}

export function canonical(cps: readonly number[]): string {
	return cps.filter(cp => cp !== VS16).map(cp => cp.toString(16)).join('-');
}

export function canonicalFromHex(hex: string): string {
	return canonical(parseCodepoints(hex));
}

/** File name stem Noto (and Blobmoji, and Google's emoji CDN) use for an emoji. */
export function notoStem(cps: readonly number[]): string {
	return cps.filter(cp => cp !== VS16).map(cp => cp.toString(16).padStart(4, '0')).join('_');
}

/** Our published key: the emojibase hexcode in lower case. */
export function outputKey(hexcode: string): string {
	return hexcode.toLowerCase();
}

/** The emoji string the client builds from a key (see hydrate_emoji in the client). */
export function keyToString(key: string): string {
	return parseCodepoints(key, '-').map(cp => String.fromCodePoint(cp)).join('');
}

const FILE_PATTERNS: Record<'plain' | 'noto', RegExp> = {
	plain: /^([0-9a-f]{1,6}(?:-[0-9a-f]{1,6})*)\.(png|svg)$/i,
	noto: /^emoji_u([0-9a-f]{1,6}(?:_[0-9a-f]{1,6})*)\.(png|svg)$/i,
};

export type FileNaming = keyof typeof FILE_PATTERNS;

/** Returns the canonical key and extension for an image file name, or null if it doesn't follow the naming scheme. */
export function parseImageName(name: string, naming: FileNaming): { key: string, ext: 'png' | 'svg' } | null {
	const match = FILE_PATTERNS[naming].exec(name);
	if (!match)
		return null;
	return {
		key: canonical(parseCodepoints(match[1]!)),
		ext: match[2]!.toLowerCase() as 'png' | 'svg',
	};
}
