import { describe, it, expect } from 'vitest';

import { createIsolatedClusterRun } from './create-isolated-cluster-run.js';
import { nativeBinding } from './native-binding.js';

describe('createIsolatedClusterRun', () => {
	it('joins pages linked in either direction', () => {
		const run = createIsolatedClusterRun([1, 2, 3, 4], []);
		run.unionEdges([2, 1, 3, 4]);
		expect([...run.labels()]).toStrictEqual([0, 0, 1, 1]);
	});

	it('numbers the components by their first candidate', () => {
		const run = createIsolatedClusterRun([10, 20, 30, 40], []);
		run.unionEdges([40, 20]);
		expect([...run.labels()]).toStrictEqual([0, 1, 2, 1]);
	});

	it('follows a redirect to its destination', () => {
		const run = createIsolatedClusterRun([1, 2], [9, 2]);
		run.unionEdges([1, 9]);
		expect([...run.labels()]).toStrictEqual([0, 0]);
	});

	it('follows an alias, a redirect and an alias in turn', () => {
		const run = createIsolatedClusterRun([1, 2], [8, 9, 9, 7, 7, 2]);
		run.unionEdges([1, 8]);
		expect([...run.labels()]).toStrictEqual([0, 0]);
	});

	it('drops an edge into a loop and into a tail leading to one', () => {
		const run = createIsolatedClusterRun([1, 2, 3], [8, 9, 9, 8, 7, 8]);
		run.unionEdges([1, 8, 2, 7]);
		expect([...run.labels()]).toStrictEqual([0, 1, 2]);
	});

	it('ignores self links, links from pages that are not candidates and links to them', () => {
		const run = createIsolatedClusterRun([1, 2], []);
		run.unionEdges([1, 1, 1, 99, 99, 2]);
		expect([...run.labels()]).toStrictEqual([0, 1]);
	});

	it('gives the same components however the edges are batched and ordered', () => {
		const edges: [number, number][] = [
			[1, 2],
			[3, 4],
			[2, 3],
			[5, 5],
			[6, 1],
		];
		const whole = createIsolatedClusterRun([1, 2, 3, 4, 5, 6], []);
		whole.unionEdges(edges.flat());
		const split = createIsolatedClusterRun([1, 2, 3, 4, 5, 6], []);
		for (const edge of edges.toReversed()) {
			split.unionEdges(edge);
		}
		expect([...split.labels()]).toStrictEqual([...whole.labels()]);
	});

	it('has no components for no candidates', () => {
		expect(createIsolatedClusterRun([], []).labels()).toHaveLength(0);
	});

	it('rejects an odd number of ids in redirects and edges', () => {
		expect(() => createIsolatedClusterRun([1], [1])).toThrow(RangeError);
		const run = createIsolatedClusterRun([1], []);
		expect(() => {
			run.unionEdges([1]);
		}).toThrow(RangeError);
	});

	it('rejects an id a Uint32Array would wrap', () => {
		expect(() => createIsolatedClusterRun([2 ** 32], [])).toThrow(RangeError);
		const run = createIsolatedClusterRun([1], []);
		expect(() => {
			run.unionEdges([1, 2 ** 32]);
		}).toThrow(RangeError);
	});
});

describe('nativeBinding.IsolatedClusterRun', () => {
	it('rejects an odd number of ids in the redirects', () => {
		expect(
			() => new nativeBinding.IsolatedClusterRun(Uint32Array.of(1), Uint32Array.of(1)),
		).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});

	it('rejects an odd number of ids in a batch of edges', () => {
		const run = new nativeBinding.IsolatedClusterRun(
			Uint32Array.of(1),
			new Uint32Array(),
		);
		expect(() => {
			run.unionEdges(Uint32Array.of(1));
		}).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});
});
