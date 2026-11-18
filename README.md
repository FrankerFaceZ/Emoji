# FrankerFaceZ Emoji Data

Builds the emoji data, images, and sprite sheets used by the
[FrankerFaceZ](https://www.frankerfacez.com/) client.

## Getting Started

You need Node 24 or newer, pnpm, and git. Nothing else: images are processed
in-process by [sharp](https://sharp.pixelplumbing.com/), and the one external
tool ([oxipng](https://github.com/shssoichiro/oxipng)) is downloaded for you.

```
pnpm install
pnpm tools      # download the pinned oxipng into .cache/tools
pnpm build      # sources, data, images, check
```

The scripts are TypeScript, run directly by Node (no build step).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm sources` | Download every source pinned in `sources.json` into `.cache/sources`. Git sources use a shallow, sparse clone, so only the image folders are downloaded. Release assets are checked against their sha256. Noto flags come from Google's emoji CDN. |
| `pnpm data` | Build `dist/v3.3.json` (the data clients download), `dist/emoji.json` (the same, spelled out), `dist/manifest.json` (source image hashes), and the committed `shipped.json`. Fails without writing anything if the inputs don't look right. |
| `pnpm images` | Write `dist/images/<style>/<key>.png` (and `.svg`), build the sprite sheets, and optimize every PNG with oxipng. |
| `pnpm check` | Run the safety checks and write `dist/report.md` and `dist/preview/*.png`. Exits with an error if anything is wrong. `--baseline <ref>` sets whose `shipped.json` to compare against (default `HEAD`). |
| `pnpm sources:check` | Look for newer upstream releases. `--write` updates `sources.json` and `package.json`. |
| `pnpm test` / `pnpm typecheck` | Unit tests and type checking. |

## Updating

Normally the [upstream workflow](.github/workflows/upstream.yml) does this
every day and opens a pull request with the check report. To do it by hand:

```
pnpm sources:check --write
pnpm install
pnpm build
```

Then commit `sources.json`, `package.json`, `pnpm-lock.yaml`, and `shipped.json`.

## Sources

Pinned in `sources.json` (images) and `package.json` (emojibase).

| Source | Used for | Notes |
| --- | --- | --- |
| [Emojibase](https://emojibase.dev/) (`emojibase-data`) | Which emoji exist, order, categories, names, shortcodes | MIT. Shortcodes come from its emojibase, GitHub, and iamcal sets. |
| [Twemoji](https://github.com/jdecked/twemoji) | `twemoji` style (client: Twitter) | The maintained fork; Twitter's repo stopped at 14.0. Code MIT, graphics CC BY 4.0. |
| [Noto Emoji](https://github.com/googlefonts/noto-emoji) | `noto` style (client: Google) | Apache 2.0. Images are in `2D/` since the Unicode 18 release. Flags come from `fonts.gstatic.com`, pinned to a version. |
| [Noto Emoji](https://github.com/googlefonts/noto-emoji), `3D/` | `noto3d` style (client: Google 3D) | Apache 2.0, per the repository README (`3D/png/` has no license file of its own; the 3D fonts are OFL). Google's 3D set, new with the Unicode 18 release. Same clone as `noto`. Gaps fall back to 2D Noto. |
| [OpenMoji](https://github.com/hfg-gmuend/openmoji) | `openmoji` style | CC BY-SA 4.0. Release zips. |
| [blobmoji2](https://github.com/DavidBerdik/blobmoji2) | `blob` style | Apache 2.0. The continuation of [Blobmoji](https://github.com/C1710/blobmoji), which was archived in 2024 at Emoji 15.1. It is a fork of Noto, so its `svg/` folder also holds Google's designs: only the files its `blobmoji_svgs_list.txt` names are used. Everything else falls back to current Noto. PNGs are generated from SVG using sharp. |

## Safety Checks

`pnpm check` runs several checks intended to catch generation errors due to
upstream format changes.

- **Inputs:** emojibase-data is validated against a schema. New fields are reported.
- **Sources:** every image source must cover most emoji and follow its naming scheme, and blobmoji2's list of blob designs must parse. A source that moved or renamed its files fails here.
- **Output:** unique keys and sprite positions, every position inside the grid, shortcodes unique and well formed, categories the client has labels for, tones the client understands, correct image counters.
- **Client:** the data is loaded by a port of the client's parser, which flags emoji that would silently overwrite each other.
- **Baseline:** compared with `shipped.json` at `--baseline`, no emoji, shortcode, or image may disappear, and no shortcode may move to another emoji. Changes in categories, presentation, and primary shortcodes are listed, and so is changed artwork (against the latest release's `manifest.json`).
- **Images:** every expected image exists, is 72x72, and isn't blank. Every sheet has the right size, every 72px cell matches its image exactly (a sample at smaller sizes), and empty cells are empty.

Errors fail the build. When a removal is intended, record it in `allow.json`
with a reason:

```json
{
	"dropShortcodes": { "some_code": "why" },
	"removedEmoji": { "1f600": "why" },
	"lostImages": { "blob:1f9ce": "why" }
}
```

Shortcodes that already shipped are always kept on the same emoji, in the same
order, even if upstream renames or drops them. Removing one takes a
`dropShortcodes` entry.

## Output

`dist/` is laid out the way it's published under `/static/emoji/`:

```
v3.3.json                                    compact data
images/<style>/<key>.png                     72x72, one per emoji
images/<style>/<key>.svg                     noto, blob, twemoji, openmoji
images/sheets/<version>/sheet-<style>-<size>.png
build.json                                   sheet sizes and hashes
```

`dist/emoji.json` and `dist/manifest.json` go into the GitHub release only.

Styles are `noto`, `noto3d`, `blob`, `twemoji`, and `openmoji`. Sheet sizes are 72, 36,
and 18, and each cell is the size plus 1px of padding on every side.

## Deploying

The [CI workflow](.github/workflows/ci.yml) releases and deploys master builds
to the new server the same way the client, add-ons, and locale builds do.

## Compact Data Format

The client downloads `v3.3.json`. It uses arrays to keep the download small and
is rehydrated by the client.

```javascript
{
	v: 3,
	n: Number, b: Number, t: Number, o: Number,  // emoji with a noto/blob/twemoji/openmoji image
	d: Number,                                   // emoji with a Noto 3D image (new in v3.3)
	c: { [group]: 'category-slug' },
	e: [EMOJI, ...],
	g: [columns, rows],                          // sprite grid (new in v3.3)
	s: 'version'                                 // sheet folder (new in v3.3)
}

EMOJI = [group, order, SHORTCODES, name || 0, key, POS, IMAGES, [VERSION, ...] || 0, type];
VERSION = [key, POS, IMAGES, tone, type, SHORTCODES];

SHORTCODES = String || [String, ...];
POS = [column, row];
IMAGES = (
	0b10000 + // Has Noto 3D Image (new in v3.3)
	0b01000 + // Has Noto Image
	0b00100 + // Has Blob Image
	0b00010 + // Has Twemoji Image
	0b00001   // Has OpenMoji Image
);
```

* `group` is the numeric id of the emoji category, a key of `c`.
* `order` is the sorting order within the category.
* `SHORTCODES` is a string for a single short code, otherwise an array. The first one is the emoji's display name.
* `name` is zero if it's the same as the first short code (upper case, underscores as spaces). Otherwise it's the Unicode name.
* `key` is the hexadecimal code for the emoji, with code points separated by `-`.
* `POS` is the position in the sprite sheets. The pixel offset of a cell is `POS * (size + 2) + 1`.
* `IMAGES` says which styles have an image. Blob and Noto 3D fall back to Noto. New styles take the next bit up, which old clients ignore.
* `VERSION` lists skin tone versions, or is `0`.
* `type` is `0` for emoji shown as text by default. Clients should only render those with a `-fe0f` presentation selector, and should add one when inserting the emoji.
* `tone` is the skin tone (1 to 5), or an array of tones for emoji with more than one person.

## License

The scripts in this repository use the MIT license. The data and images
inherit the licenses of their sources, listed above.
