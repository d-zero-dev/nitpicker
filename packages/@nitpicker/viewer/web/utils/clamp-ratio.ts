/**
 * Clamps a 0–1 ratio to the inclusive `[0, 1]` interval.
 *
 * Used by ratio bars whose underlying source can legitimately overflow
 * (e.g. metadata fulfillment is `filled / total`, which is always
 * `≤ 1` by construction — but a future refactor that swapped numerator
 * and denominator would silently render a 200%-wide bar through the
 * track if this guard were not in place).
 *
 * `NaN` flows through verbatim — the downstream `formatPercent` helper
 * turns it into `'0%'`, so the bar shows a clean zero rather than a
 * spurious label. Suppressing NaN here would mask upstream bugs.
 * @param ratio - The input ratio.
 * @returns The value clamped to `[0, 1]`, or `NaN` if the input was NaN.
 */
export function clampRatio(ratio: number): number {
	return Math.max(0, Math.min(1, ratio));
}
