import type { SheetName } from '@nitpicker/report-google-sheets';

import { SHEET_PRIORITY_ORDER } from '@nitpicker/report-google-sheets';

// Not statically checked against `SHEET_PRIORITY_ORDER` — adding a sheet
// there without an entry here just means operators can't use a short alias
// for it (the exact name in `parseSheetNames`'s fallback still works), so a
// missing alias fails quietly rather than at compile time. Add an entry
// here whenever `SHEET_PRIORITY_ORDER` gains a new sheet name.
const SHEET_NAME_ALIASES: Record<string, SheetName> = {
	'page-list': 'Page List',
	pagelist: 'Page List',
	pages: 'Page List',
	links: 'Links',
	violations: 'Violations',
	discrepancies: 'Discrepancies',
	resources: 'Resources',
	images: 'Images',
	'referrers-relational-table': 'Referrers Relational Table',
	'referrers-rel-table': 'Referrers Relational Table',
	'resources-relational-table': 'Resources Relational Table',
	'resources-rel-table': 'Resources Relational Table',
	summary: 'Summary',
};

/**
 * Parses a comma-separated `--sheets` flag value into sheet names, resolving
 * short aliases (`pages`, `referrers-rel-table`, ...) and exact sheet names
 * (`Page List`, ...) case-insensitively.
 * @param raw - The raw `--sheets` flag value (e.g. `"pages,links,resources"`).
 * @returns The resolved sheet names, in the caller-given order.
 * @throws {Error} If any comma-separated entry doesn't match a known alias or sheet name.
 * @example
 * ```ts
 * parseSheetNames('pages,links,resources,referrers-rel-table');
 * // => ['Page List', 'Links', 'Resources', 'Referrers Relational Table']
 * ```
 */
export function parseSheetNames(raw: string): SheetName[] {
	return raw.split(',').map((entry) => {
		const trimmed = entry.trim();
		const key = trimmed.toLowerCase();
		const alias = SHEET_NAME_ALIASES[key];
		if (alias) {
			return alias;
		}
		const exact = SHEET_PRIORITY_ORDER.find((name) => name.toLowerCase() === key);
		if (exact) {
			return exact;
		}
		throw new Error(
			`Unknown sheet name: "${trimmed}". Valid names: ${SHEET_PRIORITY_ORDER.join(', ')} (or their aliases: ${Object.keys(SHEET_NAME_ALIASES).join(', ')}).`,
		);
	});
}
