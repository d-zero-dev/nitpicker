/**
 * Formats a 0–1 ratio as a localised percent string for the summary
 * dashboard. Centralises three previously-inconsistent precisions
 * (integer / 1-decimal / tooltip) in one helper so every bar group reads
 * the same way.
 *
 * The contract:
 * - `0` → `'0%'` (exact zero — the underlying count is 0, no ambiguity)
 * - very small but non-zero → `'<0.1%'` (a non-zero count rounded to
 *   `0.0%` looks like a contradiction; `<0.1%` instead conveys "this is
 *   measured, just tiny")
 * - everything else → 1 decimal place (`'12.3%'`, `'100.0%'`)
 *
 * Ratios outside [0, 1] are clamped — the bars can't render below 0 or
 * above the track anyway, so the label should match. NaN guards against
 * an upstream divide-by-zero (any reduce over an empty distribution
 * would otherwise propagate NaN into the cell). Negative zero (`-0`)
 * falls into the `ratio <= 0` branch and renders as `'0%'`, same as
 * positive zero — JavaScript's `<=` treats them as equal.
 * @param ratio - The share as a 0–1 ratio.
 * @returns The localised percent string.
 */
export function formatPercent(ratio: number): string {
	if (!Number.isFinite(ratio) || ratio <= 0) {
		return '0%';
	}
	const clamped = Math.min(ratio, 1);
	const percent = clamped * 100;
	if (percent < 0.1) {
		return '<0.1%';
	}
	return `${percent.toFixed(1)}%`;
}
