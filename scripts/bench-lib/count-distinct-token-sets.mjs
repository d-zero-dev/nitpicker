import { canonicalizeTokenSet } from '../../packages/@nitpicker/archive/lib/template-classification/page-cluster/canonicalize-token-set.js';

/**
 * Counts the distinct per-page token sets of one block — how many sets
 * Stage A would have to compare if pages with identical sets were merged
 * first (the de-duplication a port could add). Each page's set is its
 * tokens plus its reinjected local-landmark tokens, the set Stage A starts
 * from; the comparison sets it derives from those can only coincide more
 * often, so this is an upper bound for them.
 * @param {readonly (readonly string[])[]} tokensByPage - Each page's tokens.
 * @param {readonly Iterable<string>[]} localTokensByPage - Each page's local
 *   landmark tokens, parallel to `tokensByPage`.
 * @returns {number} The number of distinct sets.
 * @example
 * countDistinctTokenSets([['a', 'b'], ['b', 'a']], [[], []]); // 1
 */
export function countDistinctTokenSets(tokensByPage, localTokensByPage) {
	return new Set(
		tokensByPage.map((tokens, position) =>
			canonicalizeTokenSet(new Set([...tokens, ...localTokensByPage[position]])),
		),
	).size;
}
