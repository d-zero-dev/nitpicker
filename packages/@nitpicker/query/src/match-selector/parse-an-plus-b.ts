/**
 * Parses the argument of `:nth-child()` / `:nth-of-type()` (`odd`, `even`,
 * `3`, `2n+1`, `-n+3`, `n`, ...) into its `An+B` coefficients.
 * @param text - The argument text without parentheses.
 * @returns The coefficients; `3` is `{ a: 0, b: 3 }`.
 * @throws {SyntaxError} If the text is not valid `An+B` syntax.
 * @example
 * parseAnPlusB('2n+1'); // { a: 2, b: 1 }
 */
export function parseAnPlusB(text: string): { a: number; b: number } {
	const normalized = text.trim().toLowerCase();
	if (normalized === 'odd') {
		return { a: 2, b: 1 };
	}
	if (normalized === 'even') {
		return { a: 2, b: 0 };
	}
	if (/^[+-]?\d+$/.test(normalized)) {
		return { a: 0, b: Number.parseInt(normalized, 10) };
	}
	const match = /^([+-]?)(\d*)n(?:\s*([+-])\s*(\d+))?$/.exec(normalized);
	if (!match) {
		throw new SyntaxError(`Invalid An+B expression: "${text}"`);
	}
	const sign = match[1] === '-' ? -1 : 1;
	const a = sign * (match[2] === '' ? 1 : Number.parseInt(match[2]!, 10));
	const b =
		match[3] === undefined
			? 0
			: (match[3] === '-' ? -1 : 1) * Number.parseInt(match[4]!, 10);
	return { a, b };
}
