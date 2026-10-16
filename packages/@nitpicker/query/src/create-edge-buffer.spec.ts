import { describe, it, expect } from 'vitest';

import { createEdgeBuffer } from './create-edge-buffer.js';

/**
 * Reads every edge of a buffer into an array of pairs.
 * @param edges - The buffer.
 */
function read(edges: ReturnType<typeof createEdgeBuffer>): [number, number][] {
	const pairs: [number, number][] = [];
	edges.each((from, to) => {
		pairs.push([from, to]);
	});
	return pairs;
}

describe('createEdgeBuffer', () => {
	it('holds no edges when nothing was added', () => {
		const edges = createEdgeBuffer();
		expect(edges.size).toBe(0);
		expect(read(edges)).toStrictEqual([]);
	});

	it('returns the edges in the order they were added', () => {
		const edges = createEdgeBuffer();
		edges.add(3, 1);
		edges.add(0, 2);
		edges.add(3, 1);
		expect(read(edges)).toStrictEqual([
			[3, 1],
			[0, 2],
			[3, 1],
		]);
		expect(edges.size).toBe(3);
	});

	it.each([1, 2, 3, 5, 8])(
		'keeps every edge across growth from a room for %i edge(s)',
		(initialEdges) => {
			const edges = createEdgeBuffer(initialEdges);
			for (let index = 0; index < 5; index++) {
				edges.add(index, index + 10);
			}
			expect(read(edges)).toStrictEqual([
				[0, 10],
				[1, 11],
				[2, 12],
				[3, 13],
				[4, 14],
			]);
			expect(edges.size).toBe(5);
		},
	);

	it('grows past the default room without losing or changing an edge', () => {
		const edges = createEdgeBuffer();
		const total = 70_000;
		for (let index = 0; index < total; index++) {
			edges.add(index, total - index);
		}
		const pairs = read(edges);
		expect(pairs).toHaveLength(total);
		expect(pairs[0]).toStrictEqual([0, 70_000]);
		expect(pairs[32_767]).toStrictEqual([32_767, 37_233]);
		expect(pairs[32_768]).toStrictEqual([32_768, 37_232]);
		expect(pairs.at(-1)).toStrictEqual([69_999, 1]);
	});

	it('raises a room of zero or less to one edge instead of failing to grow', () => {
		const edges = createEdgeBuffer(0);
		edges.add(1, 2);
		edges.add(3, 4);
		expect(read(edges)).toStrictEqual([
			[1, 2],
			[3, 4],
		]);
	});

	it('keeps an index of 2**32 - 1 intact', () => {
		const edges = createEdgeBuffer();
		edges.add(4_294_967_295, 0);
		expect(read(edges)).toStrictEqual([[4_294_967_295, 0]]);
	});
});
