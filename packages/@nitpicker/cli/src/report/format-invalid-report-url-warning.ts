import type { ListItem } from '@d-zero/readtext/list';

/**
 * Offending lines longer than this are truncated in the warning so one
 * pathological line (e.g. a base64 blob that ended up in the list) cannot
 * flood the terminal. Same limit as `formatInvalidRecrawlUrlWarning`.
 */
const MAX_OFFENDING_LINE_LENGTH = 200;

/**
 * Formats the operator-facing warning for a single invalid `report --urls`
 * list line: `skipping invalid URL at <listFile>:<line>:<column> — "<value>"`.
 *
 * Mirrors `formatInvalidRecrawlUrlWarning` with `report list` in place of
 * `recrawl list` — kept as a separate function rather than a shared parameter
 * so neither message text can drift out of sync with its own command's
 * terminology by an unrelated edit to the other.
 * @param listFile - The `--urls` value as typed by the operator (not resolved).
 * @param item - The invalid line, with its position in the source file.
 * @returns The formatted warning line, ready for `console.warn`.
 * @example
 * ```ts
 * formatInvalidReportUrlWarning('urls.txt', { value: 'not-a-url', line: 3, column: 1 });
 * // '[nitpicker] report list: skipping invalid URL at urls.txt:3:1 — "not-a-url"'
 * ```
 */
export function formatInvalidReportUrlWarning(listFile: string, item: ListItem): string {
	const offendingLine =
		item.value.length > MAX_OFFENDING_LINE_LENGTH
			? `${item.value.slice(0, MAX_OFFENDING_LINE_LENGTH)}…`
			: item.value;
	return `[nitpicker] report list: skipping invalid URL at ${listFile}:${item.line}:${item.column} — "${offendingLine}"`;
}
