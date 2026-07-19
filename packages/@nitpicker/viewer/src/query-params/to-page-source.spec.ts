import { describe, expect, it } from 'vitest';

import { toPageSource } from './to-page-source.js';

describe('toPageSource', () => {
	it('returns undefined for missing input', () => {
		expect(toPageSource()).toBeUndefined();
	});

	it('returns undefined for empty string', () => {
		expect(toPageSource('')).toBeUndefined();
	});

	it('returns the narrowed value for every known source', () => {
		expect(toPageSource('crawled')).toBe('crawled');
		expect(toPageSource('inventory-seed')).toBe('inventory-seed');
		expect(toPageSource('inventory-discovered')).toBe('inventory-discovered');
	});

	it('returns undefined for unknown values (silent drop, matching toContentTypeCategory)', () => {
		expect(toPageSource('bogus')).toBeUndefined();
		expect(toPageSource('CRAWLED')).toBeUndefined();
		expect(toPageSource('__proto__')).toBeUndefined();
	});
});
