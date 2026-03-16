/**
 * Normalize an optional parameter that may be a single value, an array,
 * null, or undefined into a guaranteed array.
 * Comma-separated strings are split into individual elements.
 * Commas inside brace expressions (e.g. `{html,php}`) are preserved.
 * @param param - The parameter to normalize.
 * @returns An array containing the parameter value(s), or an empty array if absent.
 */
export function normalizeToArray(param: string | string[] | null | undefined): string[] {
	if (!param) return [];
	const arr = Array.isArray(param) ? param : [param];
	return arr.flatMap((item) => splitByTopLevelComma(item));
}

/**
 * Split a string by commas that are not inside brace expressions (`{}`).
 * @param input - The string to split.
 * @returns An array of trimmed, non-empty segments.
 */
function splitByTopLevelComma(input: string): string[] {
	const segments: string[] = [];
	let current = '';
	let depth = 0;

	for (const ch of input) {
		if (ch === '{') {
			depth++;
			current += ch;
		} else if (ch === '}') {
			depth = Math.max(0, depth - 1);
			current += ch;
		} else if (ch === ',' && depth === 0) {
			const trimmed = current.trim();
			if (trimmed) {
				segments.push(trimmed);
			}
			current = '';
		} else {
			current += ch;
		}
	}

	const trimmed = current.trim();
	if (trimmed) {
		segments.push(trimmed);
	}

	return segments;
}
