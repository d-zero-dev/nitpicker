/**
 * Checks that every literal occurs in the document, each after the
 * previous one — a necessary condition for a selector whose compounds are
 * ancestor-first, since an ancestor's start tag precedes its descendant's.
 *
 * Taking the leftmost occurrence of each literal in turn is optimal (it
 * leaves the most room for the rest), so a greedy `indexOf` chain decides
 * this without backtracking, in time linear in the document plus the
 * literals. A regular expression of the form `a.*?b.*?c` is deliberately
 * not used: its failure case backtracks through every combination.
 * @param lowerCasedHtml - The document, lower-cased once by the caller.
 * @param literals - Lower-cased literals in order, or `null` for no constraint.
 * @returns `false` only when the selector cannot match.
 * @example
 * passesOrderedPrefilter('<nav><a href="/x">', ['<nav', '<a']); // true
 */
export function passesOrderedPrefilter(
	lowerCasedHtml: string,
	literals: readonly string[] | null,
): boolean {
	if (literals === null) {
		return true;
	}
	let position = 0;
	for (const literal of literals) {
		const index = lowerCasedHtml.indexOf(literal, position);
		if (index === -1) {
			return false;
		}
		position = index + literal.length;
	}
	return true;
}
