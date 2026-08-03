import { describe, expect, it } from 'vitest';

import { buildMismatchesFilterKey } from './build-mismatches-filter-key.js';

describe('buildMismatchesFilterKey', () => {
	it('produces different keys for different types', () => {
		expect(buildMismatchesFilterKey({ type: 'canonical' })).not.toBe(
			buildMismatchesFilterKey({ type: 'og:title' }),
		);
	});

	it('produces the same key for the same type across calls', () => {
		expect(buildMismatchesFilterKey({ type: 'canonical' })).toBe(
			buildMismatchesFilterKey({ type: 'canonical' }),
		);
	});

	it('produces the same key for a type array regardless of element order', () => {
		expect(buildMismatchesFilterKey({ type: ['canonical', 'og:title'] })).toBe(
			buildMismatchesFilterKey({ type: ['og:title', 'canonical'] }),
		);
	});

	it('produces a different key for a scalar than for a single-element array', () => {
		expect(buildMismatchesFilterKey({ type: 'canonical' })).not.toBe(
			buildMismatchesFilterKey({ type: ['canonical'] }),
		);
	});
});
