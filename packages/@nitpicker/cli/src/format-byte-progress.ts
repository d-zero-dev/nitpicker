import { formatProgressCount } from './format-progress-count.js';

/**
 * Formats a bytes/totalBytes pair as `"N/M MB (x%)"`, shared by
 * `createByteProgressLogger` (label + `%braille%`-animated `Lanes` lines)
 * and the `TaskList`-based byte progress call sites (`create-setup-task-list.ts`,
 * `viewer-build.ts`'s backup/extract steps), which render the same count as
 * a bare `ctx.progress()` message with no label of their own — the row's
 * name already says what's happening.
 *
 * The MB counts are rounded for display, but the total is never rounded down
 * to `0` for a genuinely non-zero `totalBytes` (an archive under ~500 KB
 * would otherwise read `formatProgressCount`'s `total === 0` as "nothing to
 * do" and render a false `100%` before extraction even starts) — a non-zero
 * total is floored at `1` MB instead, and the processed count is clamped to
 * that total once `bytes` reaches it so completion still reads `100%`.
 * @param bytes - Bytes processed so far.
 * @param totalBytes - Total bytes expected.
 * @returns e.g. `"50/100 MB (50%)"`.
 * @example
 * ```ts
 * formatByteProgress(50_000_000, 100_000_000); // "50/100 MB (50%)"
 * ```
 */
export function formatByteProgress(bytes: number, totalBytes: number): string {
	const totalMB = totalBytes > 0 ? Math.max(1, Math.round(totalBytes / 1_000_000)) : 0;
	const bytesMB =
		totalBytes > 0 && bytes >= totalBytes
			? totalMB
			: Math.min(totalMB, Math.round(bytes / 1_000_000));
	return formatProgressCount(bytesMB, totalMB, 'MB');
}
