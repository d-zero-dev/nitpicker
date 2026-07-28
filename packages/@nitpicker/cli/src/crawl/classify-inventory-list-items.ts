import type { ListItem } from '@d-zero/readtext/list';

import { isValidUrl } from './is-valid-url.js';

/**
 * Splits position-tagged inventory-list lines into URLs the `URL`
 * constructor accepts and lines that are not, preserving source order
 * within each group.
 *
 * `--inventory` source lists come from machine-generated intermediates
 * (a doc-root `ls`, a spreadsheet export) where a handful of malformed
 * lines are the norm, not the exception — this lets `inventoryCrawl` warn
 * and continue with the valid subset instead of aborting the whole run on
 * the first bad line (issue #99).
 * @param items - Position-tagged lines read from the `--inventory` list file.
 * @returns `valid` URL strings and `invalid` items retaining their original line/column.
 * @example
 * ```ts
 * const { valid, invalid } = classifyInventoryListItems([
 *   { value: 'https://example.com/', line: 1, column: 1 },
 *   { value: 'not-a-url', line: 2, column: 1 },
 * ]);
 * // valid: ['https://example.com/'], invalid: [{ value: 'not-a-url', line: 2, column: 1 }]
 * ```
 */
export function classifyInventoryListItems(items: readonly ListItem[]): {
	valid: string[];
	invalid: ListItem[];
} {
	const valid: string[] = [];
	const invalid: ListItem[] = [];
	for (const item of items) {
		if (isValidUrl(item.value)) {
			valid.push(item.value);
		} else {
			invalid.push(item);
		}
	}
	return { valid, invalid };
}
