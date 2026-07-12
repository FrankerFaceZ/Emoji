'use strict';

let shortcodes_data = require('emojibase-data/en/shortcodes/emojibase.json')

/**
 * @param {string} emoji_hexcode
 * @returns {string[]} shortcodes
 */
function get_shortcodes(emoji_hexcode) {
	const code_or_codes = shortcodes_data[emoji_hexcode];
	if (!Array.isArray(code_or_codes)) return [code_or_codes];
	return code_or_codes
}

module.exports = { get_shortcodes }
