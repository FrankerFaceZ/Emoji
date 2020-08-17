# FrankerFaceZ Emoji Data

This repository contains the logic for building the emoji data set, sprite
sheets, and optimized images used by the official
[FrankerFaceZ](https://www.frankerfacez.com/) client.

## Getting Started

1. Clone this repository.
2. Initialize the git submodules in `sources/`
3. `npm install`

### Updating

```
npm install --save emojibase-data@latest emoji-datasource@latest
```

### Building Data

The following command runs all the scripts necessary to generate `emoji.json` and
`emoji-compact.json`.

```
npm run data
```

## Building the Images

### Prerequisites

Before building images, you need several utilities available within your PATH
that will be used for processing images:

* `montage` - Part of ImageMagick. Used to build sprite sheets.
* `mogrify` - Part of ImageMagick. Used to resize PNG images in bulk.

* `pngcrush`, `optipng`, `pngout`, `advpng`, `zopflipng` - Used during image optimization.

> **Note:** Image optimization programs are not required, however images will
obviously not be optimized if none are installed.


### Compact Data Format

The official FrankerFaceZ client consumes the `emoji-compact.json` data format. This
format uses arrays to minimize the amount of data the client must download, and is
designed to be rehydrated on the client.

Each emoji entry is formatted as follows:
```javascript
EMOJI = [group, order, SHORTCODES, name || 0, key, POS, IMAGES, [list, of, VERSION, ...] || 0, type];

SHORTCODES = String || [list, of, String, ...];
POS = [Number, Number];
IMAGES = (
	0b1000 + // Has Noto Image
	0b0100 + // Has Blob Image
	0b0010 + // Has Twemoji Image
	0b0001   // Has OpenMoji Image
);
VERSION = [
	key,
	POS,
	IMAGES,
	tone,
	type,
	SHORTCODES
];
```

* `group` is the numeric id of the emoji category. Categories are included in the
data file as an associative array.
* `order` is the sorting order for the emoji. Emoji within each category should be
sorted using this number.
* `SHORTCODES` is either a String if there is a single short code, or an array of
strings if there are multiple short codes.
* `name` is zero if the name is not distinct from the first short code. Otherwise,
`name` is a String. The name is checked against the short code by converting it to
lower case and replacing spaces with underscores.
* `key` is the hexadecimal code for the emoji, with code points separated by `-`
characters.
* `POS` is the sprite sheet position for the emoji or emoji version.
* `IMAGES` is a bitfield that lets the client know if each emoji style has an image
for a specific emoji.
* `VERSION` is an array of versions for an emoji. This is used for emoji that have
variations with different skin tones. If there are no versions for an emoji, this
will be `0`.
* `type` indicates whether the emoji is represented as text by default (`0`) or
graphically (`1`). If an emoji is presented as text by default, then clients should
only display this emoji if it's marked with a graphical presentation variation. (So,
followed with a `-fe0f`.) Additionally, when inserting the emoji into text after
being selected from a menu or completed from a short code, text emoji should also
have an additional `-fe0f` inserted to force them to render graphically.
* `tone` indicates the skin tone for emoji variants.


### Commands

The following command runs the commands to:

1. copy all image files into the directory structure that the FrankerFaceZ client expects
2. resize the PNG images to the desired size (72x72)
3. Construct sprite sheets
4. Optimize all images.

```
npm run images
```

> **Note:** Optimizing images is a very slow operation. If you want to do everything
except optimization, please run the command: `npm run images:basic` instead.


## Available Commands

### `npm run fixnoto`

Downloads Noto emoji that are missing from the Noto repository. Notably, this
includes all national flag emoji.

### `npm run resizenoto`

Resizes Noto and Blob emoji to `72x72`, as the repositories only include `128x128`.

### `npm run shortcodes`

Download a list of short codes from the GitHub API and merge it with extra
short codes from the `emoji-data` package.

### `npm run datafile`

Build the main emoji data files. This checks for the existence of image files
in each style and merges in short codes from the shortcodes command.

### `npm run copy`

Copy all image files into the `images/` subdirectory using the expected
naming scheme. Populates missing Blob emoji images from the Noto image sources.

### `npm run sheets`

Build sprite sheets for each of the emoji styles in 18x18, 36x36, and 72x72 sizes.

### `npm run optiimze`

For each individual emoji PNG, as well as each sprite sheet, try to optimize
the image using `pngcrush`, `optipng`, `pngout`, `advpng`, and `zopflipng`. The
smallest file will be taken. This script takes a long time to execute.

> **Note:** The scripts related to image processing are based off of build
> scripts from the `emoji-data` library, without any extra dependency on PHP.


## License

The scripts in this repository use the MIT license. The data, however,
inherits licenses from several different sources as indicated in the Sources
section below:


## Sources

### Data Sources

* [Emojibase](https://emojibase.dev/) - This is the primary data source we use
as the truth to determine which emoji exist.
    * License: [MIT](https://github.com/milesj/emojibase/blob/master/LICENSE)
* [GitHub](https://github.com/) - We use GitHub's [emojis API endpoint](https://api.github.com/emojis)
to look up additional short codes.
    * License: [GitHub ToS](https://docs.github.com/en/github/site-policy/github-terms-of-service)
* [emoji-data](https://github.com/iamcal/emoji-data) - We used to use emoji-data
as our main source of emoji data, but it isn't updated frequently. Now, we use
the module only to continue supporting short codes that we used before.
    * License: [MIT](https://github.com/iamcal/emoji-data/blob/master/LICENSE)


### Image Sources

* [Twemoji](https://github.com/twitter/twemoji) - The default emoji style for
FrankerFaceZ. Used by and provided by Twitter.
    * Data License: [Apache 2](https://github.com/twitter/twemoji/blob/master/LICENSE)
    * Image License: [CC BY 4.0](https://github.com/twitter/twemoji/blob/master/LICENSE-GRAPHICS)
* [Google Noto](https://github.com/googlefonts/noto-emoji) - The style used by
Google projects, including Android.
    * License: [Apache 2](https://github.com/googlefonts/noto-emoji/blob/master/LICENSE)
* [Blobmoji](https://github.com/C1710/blobmoji) - A fork of an old version of Noto
emoji, popular with many people due to the charming 'blob' look of the smileys.
    * License: [Apache 2](https://github.com/C1710/blobmoji/blob/master/LICENSE)
* [OpenMoji](https://openmoji.org/library/#emoji=1F9DF) - An open source, community
driven emoji style.
    * License: [CC BY-SA 4.0](https://github.com/hfg-gmuend/openmoji/blob/master/LICENSE.txt)