import { describe, expect, it } from 'vitest';

import { resolveListSortBy } from './resolve-list-sort-by.js';

const ALLOWED = ['url', 'rule'] as const;

describe('resolveListSortBy', () => {
	it('returns the requested field when it is in the allow-list', () => {
		expect(resolveListSortBy('rule', ALLOWED, 'url')).toBe('rule');
	});

	it('returns the fallback when sortBy is undefined', () => {
		expect(resolveListSortBy(undefined, ALLOWED, 'url')).toBe('url');
	});

	it('returns the fallback when sortBy is not in the allow-list', () => {
		expect(resolveListSortBy('bogus' as (typeof ALLOWED)[number], ALLOWED, 'url')).toBe(
			'url',
		);
	});
});
