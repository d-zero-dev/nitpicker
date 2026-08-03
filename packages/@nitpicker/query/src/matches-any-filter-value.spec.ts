import { describe, expect, it } from 'vitest';

import { matchesAnyFilterValue } from './matches-any-filter-value.js';

describe('matchesAnyFilterValue', () => {
	it('matches an equal scalar', () => {
		expect(matchesAnyFilterValue('dns', 'dns')).toBe(true);
	});

	it('rejects an unequal scalar', () => {
		expect(matchesAnyFilterValue('dns', 'timeout')).toBe(false);
	});

	it('matches when the item value is included in the filter array', () => {
		expect(matchesAnyFilterValue('dns', ['dns', 'timeout'])).toBe(true);
	});

	it('rejects when the item value is not included in the filter array', () => {
		expect(matchesAnyFilterValue('tls', ['dns', 'timeout'])).toBe(false);
	});

	it('treats undefined as "no filter"', () => {
		expect(matchesAnyFilterValue('dns')).toBe(true);
	});

	it('treats an empty array as "no filter", not "match nothing"', () => {
		expect(matchesAnyFilterValue('dns', [])).toBe(true);
	});
});
