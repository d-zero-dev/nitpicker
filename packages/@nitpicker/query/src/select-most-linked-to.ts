/**
 * Picks the `limit` nodes with the highest in-degree, as node indexes in the
 * order a stable sort by in-degree descending puts them: higher in-degree
 * first, equal in-degrees in index order.
 *
 * Returns the same nodes in the same order as
 * `indexes.toSorted((a, b) => inDegree[b] - inDegree[a]).slice(0, limit)`
 * without sorting all of them: a histogram of the in-degrees finds the cutoff
 * in-degree, one pass collects the nodes at or above it, and only those
 * `limit` nodes are sorted. Time is linear in the number of nodes plus the
 * highest in-degree; memory is the histogram and the `limit` kept indexes.
 * @param inDegree - In-degree of each node, by node index; counts, so never
 *   negative.
 * @param limit - How many nodes to keep; a fraction is cut down, and a limit
 *   of `inDegree.length` or more keeps every node.
 * @returns The kept node indexes.
 * @example
 * selectMostLinkedTo(Int32Array.of(1, 5, 5, 0, 2), 3); // [1, 2, 4]
 */
export function selectMostLinkedTo(inDegree: Int32Array, limit: number): number[] {
	const count = Math.floor(limit);
	// Written as a negated `>` so that `NaN`, which compares false to everything,
	// keeps nothing too.
	if (!(count > 0)) {
		return [];
	}
	let highest = 0;
	for (const degree of inDegree) {
		highest = Math.max(highest, degree);
	}
	const histogram = new Uint32Array(highest + 1);
	for (const degree of inDegree) {
		histogram[degree]!++;
	}
	// The lowest in-degree that still makes the cut, and how many nodes sitting
	// exactly at it fit.
	let cutoff = highest;
	let above = 0;
	while (cutoff > 0 && above + histogram[cutoff]! < count) {
		above += histogram[cutoff]!;
		cutoff--;
	}
	let room = count - above;
	const kept: number[] = [];
	for (const [index, degree] of inDegree.entries()) {
		if (degree > cutoff) {
			kept.push(index);
		} else if (degree === cutoff && room > 0) {
			kept.push(index);
			room--;
		}
	}
	return kept.toSorted((a, b) => inDegree[b]! - inDegree[a]! || a - b);
}
