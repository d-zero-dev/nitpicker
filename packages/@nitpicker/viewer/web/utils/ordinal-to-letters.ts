/**
 * Renders a 1-based ordinal as a spreadsheet-style column letter: `1` → `A`,
 * `26` → `Z`, `27` → `AA`, `52` → `AZ`, `53` → `BA`.
 *
 * This is bijective base-26 (no zero digit), not plain base-26 — which is
 * what makes `Z` roll over to `AA` rather than `BA`.
 * @param ordinal - A positive integer.
 * @returns The letter sequence.
 * @throws {RangeError} For a non-positive or non-integer ordinal, which
 *   has no letter form; a stored label never carries one.
 * @example
 * ```ts
 * ordinalToLetters(28); // 'AB'
 * ```
 */
export function ordinalToLetters(ordinal: number): string {
	if (!Number.isInteger(ordinal) || ordinal < 1) {
		throw new RangeError(`ordinalToLetters: expected a positive integer, got ${ordinal}`);
	}
	let n = ordinal;
	let letters = '';
	while (n > 0) {
		const remainder = (n - 1) % 26;
		letters = String.fromCodePoint(65 + remainder) + letters;
		n = Math.floor((n - 1) / 26);
	}
	return letters;
}
