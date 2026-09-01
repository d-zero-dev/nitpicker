import type { ListItem } from '@d-zero/readtext/list';

/**
 * Offending lines longer than this are truncated in the warning so one
 * pathological line (e.g. a base64 blob that ended up in the list) cannot
 * flood the terminal. Same limit as `formatInvalidInventoryUrlWarning`.
 */
const MAX_OFFENDING_LINE_LENGTH = 200;

/**
 * Formats the operator-facing warning for a single invalid `--recrawl` list
 * line: `skipping invalid URL at <listFile>:<line>:<column> — "<value>"`.
 *
 * Mirrors `formatInvalidInventoryUrlWarning` with `recrawl list` in place of
 * `inventory list` — kept as a separate function rather than a shared
 * parameter so neither message text can drift out of sync with its own
 * command's terminology by an unrelated edit to the other.
 * @param listFile - The `--recrawl` value as typed by the operator (not resolved).
 * @param item - The invalid line, with its position in the source file.
 * @returns The formatted warning line, ready for `console.warn`.
 * @example
 * ```ts
 * formatInvalidRecrawlUrlWarning('urls.txt', { value: 'not-a-url', line: 3, column: 1 });
 * // '[nitpicker] recrawl list: skipping invalid URL at urls.txt:3:1 — "not-a-url"'
 * ```
 */
export function formatInvalidRecrawlUrlWarning(listFile: string, item: ListItem): string {
	const offendingLine =
		item.value.length > MAX_OFFENDING_LINE_LENGTH
			? `${item.value.slice(0, MAX_OFFENDING_LINE_LENGTH)}…`
			: item.value;
	return `[nitpicker] recrawl list: skipping invalid URL at ${listFile}:${item.line}:${item.column} — "${offendingLine}"`;
}
