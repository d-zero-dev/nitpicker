import { describe, expect, it } from 'vitest';

import { resolveErrorKindsSort } from './resolve-error-kinds-sort.js';

describe('resolveErrorKindsSort', () => {
	it('defaults to count/desc when no options are given', () => {
		expect(resolveErrorKindsSort({})).toEqual({ sortBy: 'count', sortOrder: 'desc' });
	});

	it('defaults sortOrder to asc for host/kind sortBy', () => {
		expect(resolveErrorKindsSort({ sortBy: 'host' })).toEqual({
			sortBy: 'host',
			sortOrder: 'asc',
		});
		expect(resolveErrorKindsSort({ sortBy: 'kind' })).toEqual({
			sortBy: 'kind',
			sortOrder: 'asc',
		});
	});

	it('honors an explicit sortOrder regardless of sortBy', () => {
		expect(resolveErrorKindsSort({ sortBy: 'host', sortOrder: 'desc' })).toEqual({
			sortBy: 'host',
			sortOrder: 'desc',
		});
		expect(resolveErrorKindsSort({ sortBy: 'count', sortOrder: 'asc' })).toEqual({
			sortBy: 'count',
			sortOrder: 'asc',
		});
	});

	it("falls back to 'count' (and its 'desc' default) for an out-of-range sortBy — e.g. a hand-edited ?sortBy= query string", () => {
		expect(
			resolveErrorKindsSort({
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulating an out-of-range value from an untyped caller (e.g. a raw query string).
				sortBy: 'bogus' as any,
			}),
		).toEqual({ sortBy: 'count', sortOrder: 'desc' });
	});

	it('computes sortOrder from the clamped sortBy, not the raw one, for an out-of-range sortBy', () => {
		// Regression test: an earlier version computed sortOrder's default from
		// the raw (unvalidated) sortBy, so an out-of-range value silently
		// defaulted to 'asc' even though the actual sort column falls back to
		// 'count' (whose default is 'desc'). Both must agree.
		const result = resolveErrorKindsSort({
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- simulating an out-of-range value from an untyped caller.
			sortBy: 'status' as any,
		});
		expect(result.sortBy).toBe('count');
		expect(result.sortOrder).toBe('desc');
	});
});
