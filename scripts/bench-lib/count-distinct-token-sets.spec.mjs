import { describe, it, expect } from 'vitest';

import { countDistinctTokenSets } from './count-distinct-token-sets.mjs';

describe('countDistinctTokenSets', () => {
	it('counts pages with the same tokens in any order or multiplicity once', () => {
		expect(
			countDistinctTokenSets(
				[
					['html>body>main', 'html>body>main>p'],
					['html>body>main>p', 'html>body>main', 'html>body>main>p'],
				],
				[[], []],
			),
		).toBe(1);
	});

	it('counts pages with different tokens separately', () => {
		expect(countDistinctTokenSets([['a'], ['b'], ['a']], [[], [], []])).toBe(2);
	});

	it('tells apart pages that differ only by their local landmark tokens', () => {
		expect(countDistinctTokenSets([['a'], ['a']], [new Set(['nav:x']), new Set()])).toBe(
			2,
		);
	});

	it('merges a local landmark token that is already among the page tokens', () => {
		expect(countDistinctTokenSets([['a', 'nav:x'], ['a']], [[], ['nav:x']])).toBe(1);
	});

	it('returns 0 for an empty block', () => {
		expect(countDistinctTokenSets([], [])).toBe(0);
	});
});
