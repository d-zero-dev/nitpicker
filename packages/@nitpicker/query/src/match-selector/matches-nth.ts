/**
 * Tests whether a 1-based sibling position satisfies `An+B` for some
 * integer `n >= 0`.
 * @param position - The 1-based position.
 * @param a - The `A` coefficient.
 * @param b - The `B` offset.
 * @returns `true` when the position is selected.
 * @example
 * matchesNth(3, 2, 1); // true (2n+1 selects 1, 3, 5, ...)
 */
export function matchesNth(position: number, a: number, b: number): boolean {
	if (a === 0) {
		return position === b;
	}
	const n = (position - b) / a;
	return Number.isInteger(n) && n >= 0;
}
