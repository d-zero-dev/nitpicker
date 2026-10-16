/**
 * Pins the native union-find behind `computeIsolatedClusters`
 * (`createIsolatedClusterRun`) to a reference implementation, written out here:
 * every edge held in memory, each destination walked through the
 * redirect/alias map with `resolveRedirectChain` (a loop gives `null` and the
 * edge is skipped), a `Map`-based union-find, and the components numbered in
 * the order their first candidate appears. The read model stores that number
 * as `component_id`, so the partition and the numbering must both match, on
 * graphs with loops, tails leading into loops and repeated redirect sources.
 */
import { createIsolatedClusterRun } from '@nitpicker/archive/isolated-cluster/create-isolated-cluster-run';
import { describe, it, expect } from 'vitest';

/**
 * Walks a redirect/alias chain to the page it lands on: the page itself when
 * it is no hop's source, and `null` when the walk meets a page twice (a loop,
 * or a tail leading into one).
 * @param startId - The page to start from.
 * @param redirectMap - Hops by source page id.
 */
function resolveRedirectChain(
	startId: number,
	redirectMap: ReadonlyMap<number, number>,
): number | null {
	const visited = new Set<number>();
	let current = startId;
	while (redirectMap.has(current)) {
		if (visited.has(current)) {
			return null;
		}
		visited.add(current);
		current = redirectMap.get(current)!;
	}
	return current;
}

/**
 * The reference algorithm: component numbers per candidate.
 * @param candidateIds - Candidate page ids in ascending order.
 * @param hops - Redirect/alias hops `[source, destination, ...]`.
 * @param edges - Link edges `[page, href, ...]`; every `page` is a candidate.
 * @param reached - Counts how often a branch decided an edge, so the caller can
 *   tell the comparison reached it.
 * @param reached.droppedIntoLoop - Edges dropped because their destination chain never ends.
 * @param reached.joinedThroughHops - Edges that joined two components through at least one hop.
 */
function referenceLabels(
	candidateIds: readonly number[],
	hops: readonly number[],
	edges: readonly number[],
	reached: { droppedIntoLoop: number; joinedThroughHops: number },
): number[] {
	const redirectMap = new Map<number, number>();
	for (let index = 0; index < hops.length; index += 2) {
		redirectMap.set(hops[index]!, hops[index + 1]!);
	}
	const candidates = new Set(candidateIds);
	const parent = new Map<number, number>();
	for (const id of candidateIds) {
		parent.set(id, id);
	}
	const find = (x: number): number => {
		let root = x;
		while (parent.get(root) !== root) {
			const next = parent.get(root)!;
			parent.set(root, parent.get(next)!);
			root = parent.get(root)!;
		}
		return root;
	};
	for (let index = 0; index < edges.length; index += 2) {
		const page = edges[index]!;
		const href = edges[index + 1]!;
		const resolved = resolveRedirectChain(href, redirectMap);
		if (resolved === null) {
			reached.droppedIntoLoop++;
			continue;
		}
		if (!candidates.has(resolved) || resolved === page) {
			continue;
		}
		const rootPage = find(page);
		const rootResolved = find(resolved);
		if (rootPage !== rootResolved) {
			parent.set(rootPage, rootResolved);
			if (resolved !== href) {
				reached.joinedThroughHops++;
			}
		}
	}
	const labelOfRoot = new Map<number, number>();
	return candidateIds.map((id) => {
		const root = find(id);
		if (!labelOfRoot.has(root)) {
			labelOfRoot.set(root, labelOfRoot.size);
		}
		return labelOfRoot.get(root)!;
	});
}

/**
 * A small deterministic generator, so a failure names the same graph on every run.
 * @param seed - The start state.
 */
function createRandom(seed: number): (limit: number) => number {
	let state = seed;
	return (limit) => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return Math.floor((state / 0x1_00_00_00_00) * limit);
	};
}

describe('createIsolatedClusterRun: native versus the reference algorithm', () => {
	it('numbers and partitions 3000 random graphs like the reference', () => {
		const next = createRandom(429);
		let joined = 0;
		const reached = { droppedIntoLoop: 0, joinedThroughHops: 0 };
		for (let round = 0; round < 3000; round++) {
			const idCount = 2 + next(40);
			const candidateIds = Array.from(
				{ length: idCount },
				(_, index) => index + 1,
			).filter(() => next(3) !== 0);
			const hops: number[] = [];
			for (let count = next(idCount); count > 0; count--) {
				// Sources and destinations are drawn from the same ids, so loops,
				// tails into loops, chains and repeated sources all occur.
				hops.push(1 + next(idCount), 1 + next(idCount));
			}
			const edges: number[] = [];
			if (candidateIds.length > 0) {
				for (let count = next(idCount * 3); count > 0; count--) {
					edges.push(candidateIds[next(candidateIds.length)]!, 1 + next(idCount + 3));
				}
			}

			const expected = referenceLabels(candidateIds, hops, edges, reached);
			const context = JSON.stringify({ candidateIds, hops, edges });

			const whole = createIsolatedClusterRun(candidateIds, hops);
			whole.unionEdges(edges);
			expect([...whole.labels()], context).toStrictEqual(expected);

			// The same edges in uneven batches: the batching must not matter.
			const batched = createIsolatedClusterRun(candidateIds, hops);
			for (let start = 0; start < edges.length; ) {
				const size = 2 * (1 + next(4));
				batched.unionEdges(edges.slice(start, start + size));
				start += size;
			}
			expect([...batched.labels()], context).toStrictEqual(expected);
			joined += candidateIds.length - new Set(expected).size;
		}
		// The graphs must join pages, or the comparison above proves nothing.
		expect(joined).toBeGreaterThan(3000);
		// Edges must have been dropped into loops and joined through hops.
		expect(reached.droppedIntoLoop).toBeGreaterThan(100);
		expect(reached.joinedThroughHops).toBeGreaterThan(100);
	});

	it('drops an edge into a loop and into a tail that leads into one', () => {
		const run = createIsolatedClusterRun([1, 2, 3], [8, 9, 9, 8, 7, 8]);
		run.unionEdges([1, 8, 2, 7, 3, 9]);
		expect([...run.labels()]).toStrictEqual(
			referenceLabels([1, 2, 3], [8, 9, 9, 8, 7, 8], [1, 8, 2, 7, 3, 9], {
				droppedIntoLoop: 0,
				joinedThroughHops: 0,
			}),
		);
		expect([...run.labels()]).toStrictEqual([0, 1, 2]);
	});
});
