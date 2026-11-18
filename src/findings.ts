/*
Every check reports Findings. Errors fail the build, warnings are shown in the
report for a human to look at, and info is just context (what was added, etc).
*/

export type Level = 'error' | 'warn' | 'info';

export interface Finding {
	level: Level;
	/** Stable identifier, used by allow.json and for grouping in the report. */
	code: string;
	message: string;
	/** Individual items (emoji keys, shortcodes, files). Kept out of `message` so long lists can be truncated. */
	items?: string[];
}

export class Findings {
	readonly list: Finding[] = [];

	add(level: Level, code: string, message: string, items?: Iterable<string>) {
		const arr = items ? [...items] : undefined;
		this.list.push({ level, code, message, items: arr?.length ? arr : undefined });
	}

	error(code: string, message: string, items?: Iterable<string>) { this.add('error', code, message, items); }
	warn(code: string, message: string, items?: Iterable<string>) { this.add('warn', code, message, items); }
	info(code: string, message: string, items?: Iterable<string>) { this.add('info', code, message, items); }

	merge(other: Findings) {
		this.list.push(...other.list);
		return this;
	}

	get errors() { return this.list.filter(f => f.level === 'error'); }
	get warnings() { return this.list.filter(f => f.level === 'warn'); }

	print(maxItems = 10) {
		const icon = { error: 'x', warn: '!', info: '-' } as const;
		for (const f of this.list) {
			console.log(` ${icon[f.level]} [${f.code}] ${f.message}`);
			if (f.items) {
				const shown = f.items.slice(0, maxItems);
				console.log(`     ${shown.join(', ')}${f.items.length > shown.length ? `, ... (${f.items.length - shown.length} more)` : ''}`);
			}
		}
	}
}
