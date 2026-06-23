/**
 * Coerces a user-typed jump-to-page input into a 1-indexed page number
 * within `[1, totalPages]`, or returns `null` if the input is not a usable
 * number.
 *
 * Operators sometimes type stray characters, paste an empty clipboard, or
 * over-shoot `totalPages` by a digit. Rather than no-op silently (frustrating
 * UX) or crash (unprofessional), we clamp to the nearest valid page —
 * matching what every browser address bar does for `Ctrl+G` style jumps.
 * Returning `null` lets the caller distinguish "do nothing" (empty input,
 * NaN) from "navigate to N" (1, totalPages, anything between).
 * @param raw - The string from the `<input>` element.
 * @param totalPages - The upper bound (≥ 1). Values below 1 collapse to 1.
 * @returns The target page (1-indexed, clamped), or `null` for no-op.
 */
export function parseJumpTarget(raw: string, totalPages: number): number | null {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return null;
	}
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed)) {
		return null;
	}
	const floored = Math.floor(parsed);
	if (floored < 1) {
		return 1;
	}
	const upperBound = Math.max(1, Math.floor(totalPages));
	if (floored > upperBound) {
		return upperBound;
	}
	return floored;
}
