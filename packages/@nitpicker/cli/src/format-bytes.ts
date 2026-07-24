/** Unit labels used by {@link formatBytes}, in ascending order of scale. */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Format a byte count as a human-readable string (e.g. `"132.6 MB"`),
 * shared by `cache list`'s per-entry sizes and its total row.
 * @param bytes - Non-negative byte count.
 * @returns The formatted size. Whole bytes below 1024 have no decimal
 *   (`"512 B"`); larger units always show one decimal place.
 * @example
 * ```ts
 * formatBytes(132_567_040); // '126.4 MB'
 * ```
 */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < UNITS.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	return `${value.toFixed(1)} ${UNITS[unitIndex]}`;
}
