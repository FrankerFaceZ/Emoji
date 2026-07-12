'use strict';

/*
This script patches data for the individual regional indicator emoji.
The emojibase library includes these starting from v6, however
they are not 'fully qualified' emoji so are missing some of the metadata fields.
*/

/**
 * @param {import("emojibase").Emoji[]} emojibase_data
 */
function patch_emojibase_data(emojibase_data) {
	let number_patched = 0;
	for (const emoji of emojibase_data) {
		if (number_patched >= 26) break
		const radix = parseInt(emoji.hexcode, 16)
		if (!is_regional_indicator(radix)) continue

		const letter_offset = radix - 0x1F1E6
		const letter = String.fromCharCode(97 + letter_offset)  // 97 is the character code for 'a'
		const up_letter = letter.toUpperCase()

		emoji.label = letter  // the 'annotation' field was renamed to 'label'
		// names are retrieved from the unicode-names dataset
		// hexcode field is already present
		// shortcodes are retrieved from the shortcodes dataset
		emoji.tags = [up_letter, "letter"]
		// emoji field is already present
		emoji.group = 8
		emoji.subgroup = 95
		emoji.order = 9000 + letter_offset
		// type field is already present
		// version field is already present

		number_patched++
	}
}

/**
 * @param {number} radix
 * @returns {boolean}
 */
function is_regional_indicator(radix) {
	return 0x1F1E6 <= radix && radix <= 0x1F1FF
}

module.exports = patch_emojibase_data;