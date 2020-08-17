'use strict';

/*
This script adds data for the individual regional indicator emoji.
The emojibase library does not include these as they aren't intended
for use outside of flags. However, all the image sources have images
for them so, why not?
*/

const out = [];

const start = 0x1F1E6;
const start_letter = 'a'.charCodeAt(0);

for(let i=0; i < 26; i++) {
	const letter = String.fromCharCode(start_letter + i),
		up_letter = letter.toUpperCase();

	out.push({
		"annotation": letter,
		"name": `REGIONAL INDICATOR ${up_letter}`,
		"hexcode": (start + i).toString(16).toUpperCase(),
		"shortcodes": [`regional_indicator_${letter}`],
		"tags": [up_letter, 'letter'],
		"emoji": String.fromCodePoint(start + i),
		"group": 8,
		"subgroup": 95,
		"order": 9000 + i,
		"type": 1,
		"version": 2
	});
}

module.exports = out;