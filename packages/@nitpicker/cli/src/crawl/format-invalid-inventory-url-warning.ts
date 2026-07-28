import type { ListItem } from '@d-zero/readtext/list';

/**
 * Offending lines longer than this are truncated in the warning so one
 * pathological line (e.g. a base64 blob that ended up in the list) cannot
 * flood the terminal.
 */
const MAX_OFFENDING_LINE_LENGTH = 200;

/**
 * Formats the operator-facing warning for a single invalid `--inventory`
 * list line: `skipping invalid URL at <listFile>:<line>:<column> — "<value>"`.
 *
 * `listFile` must be the string the operator typed on the command line,
 * NOT the resolved absolute path — printing the absolute path would leak
 * user-home / OS structure into terminal output and logs, the same
 * privacy concern `CrawlerOrchestrator.inventory` already avoids at the
 * orchestrator boundary.
 * @param listFile - The `--inventory` value as typed by the operator (not resolved).
 * @param item - The invalid line, with its position in the source file.
 * @returns The formatted warning line, ready for `console.warn`.
 * @example
 * ```ts
 * formatInvalidInventoryUrlWarning('urls.txt', { value: 'not-a-url', line: 3, column: 1 });
 * // '[nitpicker] inventory list: skipping invalid URL at urls.txt:3:1 — "not-a-url"'
 * ```
 */
export function formatInvalidInventoryUrlWarning(
	listFile: string,
	item: ListItem,
): string {
	const offendingLine =
		item.value.length > MAX_OFFENDING_LINE_LENGTH
			? `${item.value.slice(0, MAX_OFFENDING_LINE_LENGTH)}…`
			: item.value;
	return `[nitpicker] inventory list: skipping invalid URL at ${listFile}:${item.line}:${item.column} — "${offendingLine}"`;
}
