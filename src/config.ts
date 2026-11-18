/*
Everything that describes *our* output contract lives here: the styles the
client knows about, the categories it has labels for, and the sprite sheet
geometry. Changing any of this needs a matching client change.
*/

export type StyleId = 'noto' | 'blob' | 'twemoji' | 'openmoji' | 'noto3d';

/** Upstream repositories / releases, as pinned in sources.json. */
export type SourceId = 'noto' | 'blobmoji' | 'twemoji' | 'openmoji';

/** A folder of images inside a source. One source can hold several (Noto has 2D and 3D). */
export type ImageSetId = 'noto' | 'noto3d' | 'blobmoji' | 'twemoji' | 'openmoji';

export interface StyleDef {
	id: StyleId;
	/** Bit in the IMAGES bitfield of the compact data. */
	bit: number;
	/** Key of this style's image counter in the compact data. */
	counter: 'n' | 'b' | 't' | 'o' | 'd';
	/** Value of the client's chat.emoji.style setting for this style. */
	client: string;
	/** Image set the files come from. */
	set: ImageSetId;
	/** If this style lacks an image, the client (and our sheets) use this style's image instead. */
	fallback?: StyleId;
	/** Only these file types are published for this style. */
	svg: boolean;
}

/**
New styles take the next bit up. Old clients only test the low four bits, so
adding one never changes what they see.
*/
export const STYLES: readonly StyleDef[] = [
	{ id: 'noto', bit: 0b00001000, counter: 'n', client: 'google', set: 'noto', svg: true },
	{ id: 'blob', bit: 0b00000100, counter: 'b', client: 'blob', set: 'blobmoji', fallback: 'noto', svg: true },
	{ id: 'twemoji', bit: 0b00000010, counter: 't', client: 'twitter', set: 'twemoji', svg: true },
	{ id: 'openmoji', bit: 0b00000001, counter: 'o', client: 'open', set: 'openmoji', svg: true },
	{ id: 'noto3d', bit: 0b00010000, counter: 'd', client: 'google3d', set: 'noto3d', fallback: 'noto', svg: false },
];

export const ALL_STYLE_BITS = STYLES.reduce((bits, s) => bits | s.bit, 0);

export const STYLE_IDS = STYLES.map(s => s.id);

/** Size of the individual published PNGs. */
export const IMAGE_SIZE = 72;

/** Sprite sheet tile sizes. Each cell is size + 2 * SHEET_PADDING pixels. */
export const SHEET_SIZES = [72, 36, 18] as const;
export const SHEET_PADDING = 1;

/** Kernel for shrinking tiles to 36/18px. Mitchell compresses ~17% smaller than lanczos3 at 36px with no visible loss at that size. */
export const SHEET_KERNEL = 'mitchell';

/** Category slugs the client has labels for (CATEGORIES in src/modules/chat/emoji.js). */
export const CLIENT_CATEGORIES = [
	'smileys-emotion',
	'people-body',
	'component',
	'animals-nature',
	'food-drink',
	'travel-places',
	'activities',
	'objects',
	'symbols',
	'flags',
];

/** Skin tones the client's tone picker understands (SKIN_TONES in emoji.js). */
export const CLIENT_TONES = [1, 2, 3, 4, 5];

/**
Shortcode sets from emojibase-data, in priority order. A shortcode belongs to
the first emoji that claims it. Shortcodes that already shipped are always
claimed first (see data/shortcodes.ts), so these only decide codes for new emoji
and new aliases. `dashes` mirrors the 2020 scripts, which rewrote '-' to '_' in
codes from GitHub and iamcal.

Deliberately left out: joypixels and cldr. Merging them in 2023 produced 49
collisions.
*/
export const SHORTCODE_SETS = [
	{ name: 'emojibase', dashes: false },
	{ name: 'github', dashes: true },
	{ name: 'iamcal', dashes: true },
] as const;

/** Shortcodes must match this. The 2020 data has '+1', '-1', 'fleur-de-lis', and 'tone1-2' style codes. */
export const SHORTCODE_PATTERN = /^[a-z0-9_+-]+$/;

/**
Emojibase lists the 26 regional indicators without a group or order since v7.
The 2020 data put them in "symbols" at the end, so keep doing that.
*/
export const REGIONAL_INDICATOR_START = 0x1F1E6;
export const REGIONAL_INDICATOR_GROUP = 8;
export const REGIONAL_INDICATOR_ORDER = 9000;
