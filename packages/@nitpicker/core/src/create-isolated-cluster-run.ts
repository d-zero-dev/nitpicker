import type { IsolatedClusterRun } from './types.js';

import { nativeBinding } from './native-binding.js';
import { toU32Ids } from './to-u32-ids.js';

/**
 * Starts the computation of the connected components of the isolated pages:
 * the inventory pages that are linked to only from other inventory pages.
 *
 * The caller reads the link edges (`anchor_edges`) from SQLite batch by batch
 * and hands each batch to {@link IsolatedClusterRun.unionEdges} as it
 * arrives, so the edges are never held: the memory follows the number of pages,
 * not the number of links. An edge to a redirect source or an alias member
 * counts as an edge to the page it finally lands on; a chain that never ends
 * (it loops, or leads into a loop) drops the edge. The components do not
 * depend on the order of the edges or how they were batched.
 *
 * The components are numbered in the order of the candidates: the first
 * candidate's component is `0`, and each later component takes the next
 * number the first time one of its candidates appears. Hand the candidates
 * over in ascending page id, which is the numbering the viewer read model
 * stores as `component_id`.
 * @param candidateIds - The candidate page ids, in the order the components
 *   are numbered in; each an integer in `0..=4294967294`.
 * @param redirects - The redirect and alias hops of the whole archive,
 *   `[source, destination, source, destination, ...]` by page id. A source
 *   listed twice keeps its last hop.
 * @returns The run.
 * @throws {RangeError} When an id is not an integer in `0..=4294967294`
 *   (`Uint32Array` would otherwise wrap it silently).
 * @example
 * ```ts
 * // Candidates 10, 20, 30; page 40 redirects to 30 and is not a candidate.
 * const run = createIsolatedClusterRun([10, 20, 30], [40, 30]);
 * run.unionEdges([10, 20, 20, 40]);
 * run.labels(); // Uint32Array [0, 0, 0]
 * ```
 */
export function createIsolatedClusterRun(
	candidateIds: ArrayLike<number>,
	redirects: ArrayLike<number>,
): IsolatedClusterRun {
	if (redirects.length % 2 !== 0) {
		throw new RangeError('redirects must hold an even number of ids');
	}
	const native = new nativeBinding.IsolatedClusterRun(
		toU32Ids(candidateIds, 'candidate ids'),
		toU32Ids(redirects, 'redirects'),
	);
	return {
		unionEdges(edges) {
			if (edges.length % 2 !== 0) {
				throw new RangeError('edges must hold an even number of ids');
			}
			native.unionEdges(toU32Ids(edges, 'edges'));
		},
		labels() {
			return native.labels();
		},
	};
}
