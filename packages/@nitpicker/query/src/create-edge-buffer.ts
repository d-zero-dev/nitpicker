import type { EdgeBuffer } from './types.js';

/** Edges the buffer has room for before it first grows. */
const DEFAULT_INITIAL_EDGES = 32_768;

/**
 * Creates a growable list of edges between nodes, each held as a pair of `u32`
 * node indexes in one typed array: 8 bytes an edge, against the dozens an
 * object per edge takes, which is what lets `getLinkGraph` keep millions of
 * edges while it counts in-degrees.
 *
 * The array doubles when it is full, so while it grows it briefly takes up to
 * three times the room of the edges it holds (the old array, the new one, and
 * the new one's empty half).
 * @param initialEdges - Edges the buffer has room for before it first grows
 *   (at least 1; smaller values are raised to 1).
 * @returns The buffer.
 * @example
 * const edges = createEdgeBuffer();
 * edges.add(0, 3);
 * edges.add(2, 1);
 * edges.each((from, to) => console.log(from, to)); // 0 3, then 2 1
 */
export function createEdgeBuffer(initialEdges = DEFAULT_INITIAL_EDGES): EdgeBuffer {
	let ends = new Uint32Array(Math.max(1, Math.floor(initialEdges)) * 2);
	let used = 0;
	return {
		add(from, to) {
			if (used === ends.length) {
				const grown = new Uint32Array(ends.length * 2);
				grown.set(ends);
				ends = grown;
			}
			ends[used++] = from;
			ends[used++] = to;
		},
		get size() {
			return used / 2;
		},
		each(callback) {
			for (let at = 0; at < used; at += 2) {
				callback(ends[at]!, ends[at + 1]!);
			}
		},
	};
}
