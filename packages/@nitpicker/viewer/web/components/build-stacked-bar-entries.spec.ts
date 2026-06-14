import { describe, expect, it } from 'vitest';

import { buildStackedBarEntries } from './build-stacked-bar-entries.js';

describe('buildStackedBarEntries', () => {
	it('returns an empty array for an empty input', () => {
		expect(buildStackedBarEntries([])).toEqual([]);
	});

	it('drops categories whose total (internal + external) is zero', () => {
		const result = buildStackedBarEntries([
			{ category: 'html', internal: 0, external: 0 },
			{ category: 'pdf', internal: 5, external: 0 },
		]);
		expect(result).toEqual([{ category: 'pdf', internal: 5, external: 0, total: 5 }]);
	});

	it('keeps categories that only have external counts', () => {
		const result = buildStackedBarEntries([
			{ category: 'image', internal: 0, external: 3 },
		]);
		expect(result).toEqual([{ category: 'image', internal: 0, external: 3, total: 3 }]);
	});

	it('sorts visible entries by total descending', () => {
		const result = buildStackedBarEntries([
			{ category: 'html', internal: 1, external: 0 },
			{ category: 'pdf', internal: 100, external: 0 },
			{ category: 'image', internal: 10, external: 0 },
		]);
		expect(result.map((e) => e.category)).toEqual(['pdf', 'image', 'html']);
	});

	it('fills the cached `total` as internal + external', () => {
		const result = buildStackedBarEntries([
			{ category: 'html', internal: 7, external: 3 },
		]);
		expect(result[0].total).toBe(10);
	});

	it('does not mutate the input array', () => {
		/* The earlier "is pure" spec checked that two calls returned equal
		   results, which is trivially true even if the function mutated
		   its input (subsequent mutations being no-ops on the already-
		   mutated state). A real mutation guard: freeze the input and
		   snapshot it for equality. `toSorted` is non-mutating by spec, but
		   if a future refactor swaps it for `.sort()` the freeze trips. */
		const input = Object.freeze([
			Object.freeze({ category: 'html', internal: 1, external: 1 }),
			Object.freeze({ category: 'pdf', internal: 0, external: 0 }),
		]);
		const snapshot = structuredClone(input);
		buildStackedBarEntries(input);
		expect(input).toEqual(snapshot);
	});
});
