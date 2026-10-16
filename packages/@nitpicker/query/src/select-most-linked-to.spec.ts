import { describe, it, expect } from 'vitest';

import { selectMostLinkedTo } from './select-most-linked-to.js';

/**
 * The reference: a stable sort of all the nodes, then a slice.
 * @param inDegree - In-degree per node.
 * @param limit - How many to keep.
 */
function sortAndSlice(inDegree: Int32Array, limit: number): number[] {
	return [...inDegree.keys()]
		.toSorted((a, b) => inDegree[b]! - inDegree[a]!)
		.slice(0, limit);
}

describe('selectMostLinkedTo', () => {
	it('keeps the highest in-degrees, ties in index order', () => {
		expect(selectMostLinkedTo(Int32Array.of(1, 5, 5, 0, 2), 3)).toStrictEqual([1, 2, 4]);
	});

	it('breaks a tie at the cutoff by index', () => {
		expect(selectMostLinkedTo(Int32Array.of(3, 3, 3, 3), 2)).toStrictEqual([0, 1]);
		expect(selectMostLinkedTo(Int32Array.of(0, 0, 0, 0), 2)).toStrictEqual([0, 1]);
	});

	it('keeps nothing for a limit of zero or less, and cuts a fraction down', () => {
		expect(selectMostLinkedTo(Int32Array.of(1, 2), 0)).toStrictEqual([]);
		expect(selectMostLinkedTo(Int32Array.of(1, 2), -1)).toStrictEqual([]);
		expect(selectMostLinkedTo(Int32Array.of(1, 2), Number.NaN)).toStrictEqual([]);
		expect(selectMostLinkedTo(Int32Array.of(1, 2, 3), 1.9)).toStrictEqual([2]);
	});

	it('keeps every node, sorted, when the limit is the node count or more', () => {
		expect(selectMostLinkedTo(Int32Array.of(1, 2, 3), 3)).toStrictEqual([2, 1, 0]);
		expect(selectMostLinkedTo(Int32Array.of(1, 2, 3), 10)).toStrictEqual([2, 1, 0]);
	});

	it('handles no nodes', () => {
		expect(selectMostLinkedTo(new Int32Array(), 5)).toStrictEqual([]);
	});

	it('matches a stable sort and slice on 2000 random in-degree lists', () => {
		let state = 429;
		const next = (limit: number): number => {
			state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
			return Math.floor((state / 0x1_00_00_00_00) * limit);
		};
		for (let round = 0; round < 2000; round++) {
			const maxDegree = 1 + next(6);
			const inDegree = Int32Array.from({ length: 1 + next(30) }, () => next(maxDegree));
			const limit = next(inDegree.length + 2);
			expect(
				selectMostLinkedTo(inDegree, limit),
				`${[...inDegree]} limit ${limit}`,
			).toStrictEqual(sortAndSlice(inDegree, limit));
		}
	});
});
