/*
allow.json records regressions we accept on purpose. The baseline checks fail
on anything removed or lost unless it's listed here with a reason, so the
reason ends up in the pull request that removes it.
*/

import { ALLOW_FILE } from './paths.ts';
import { exists, readJson } from './util.ts';

export interface Allow {
	/** Shortcode => reason. Dropped from the output even if it shipped before. */
	dropShortcodes: Record<string, string>;
	/** Emoji key => reason. The emoji may disappear from the output. */
	removedEmoji: Record<string, string>;
	/** "style:key" => reason. The style may lose its image for that emoji. */
	lostImages: Record<string, string>;
}

export async function loadAllow(): Promise<Allow> {
	const empty: Allow = { dropShortcodes: {}, removedEmoji: {}, lostImages: {} };
	if (!await exists(ALLOW_FILE))
		return empty;
	const raw = await readJson<Partial<Allow>>(ALLOW_FILE);
	return {
		dropShortcodes: raw.dropShortcodes ?? {},
		removedEmoji: raw.removedEmoji ?? {},
		lostImages: raw.lostImages ?? {},
	};
}
