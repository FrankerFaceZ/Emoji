'use strict';

/** @type {Record<string, string | string[]>} */
const emojibase_shortcodes_data = require('emojibase-data/en/shortcodes/emojibase.json')
/** @type {Record<string, string | string[]>} */
const emojibase_legacy_shortcodes_data = require('emojibase-data/en/shortcodes/emojibase-legacy.json')
/** @type {Record<string, string | string[]>} */
const github_shortcodes_data = require('emojibase-data/en/shortcodes/github.json')
/** @type {Record<string, string | string[]>} */
const iamcal_shortcodes_data = require('emojibase-data/en/shortcodes/iamcal.json')


/** @type {Map<string, string[]>} */
const shortcodes_data = new Map

const shortcodes_data_sources = [
	emojibase_shortcodes_data,
	emojibase_legacy_shortcodes_data,
	github_shortcodes_data,
	iamcal_shortcodes_data,
]

for (const source of shortcodes_data_sources) {
	for (const [emoji_hexcode, short_code_or_codes] of Object.entries(source)) {
		let all_shortcodes= shortcodes_data.get(emoji_hexcode)
		if (all_shortcodes == null) {
			all_shortcodes = []
			shortcodes_data.set(emoji_hexcode, all_shortcodes)
		}
		if (Array.isArray(short_code_or_codes)) all_shortcodes.push(...short_code_or_codes)
		else all_shortcodes.push(short_code_or_codes)
	}
}


/**
 * @param {string} emoji_hexcode
 * @returns {string[]} shortcodes
 */
function get_shortcodes(emoji_hexcode) {
	return shortcodes_data.get(emoji_hexcode)
}

module.exports = { get_shortcodes }
