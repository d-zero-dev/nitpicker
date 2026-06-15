/**
 * Safely computes `count / total` as a 0–1 ratio, returning `0` when the
 * denominator is zero.
 *
 * The summary status distribution can legitimately have a zero total (an
 * archive with no scraped pages yet, or a fixture with every row stripped).
 * Without the guard, the calling component would render `NaN%` in the
 * status bar; with it, every row collapses to `0%` and the user sees an
 * empty histogram rather than a corrupted one.
 *
 * Negative inputs are passed through verbatim — they should never occur
 * (counts are non-negative by construction), so emitting a negative
 * ratio is the loudest possible signal that an upstream invariant broke.
 * @param count - The numerator (e.g. status-200 rows).
 * @param total - The denominator (e.g. all status rows).
 * @returns The ratio in [0, 1], or `0` when `total === 0`.
 */
export function computeRatio(count: number, total: number): number {
	return total > 0 ? count / total : 0;
}
