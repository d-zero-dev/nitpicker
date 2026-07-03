import { describe, expect, it } from 'vitest';

import { buildAnchorFactsFilterKey } from './build-anchor-facts-filter-key.js';

describe('buildAnchorFactsFilterKey', () => {
	it('produces the same key for an empty options object and an explicit status: undefined', () => {
		expect(buildAnchorFactsFilterKey({})).toBe(
			buildAnchorFactsFilterKey({ status: undefined }),
		);
	});

	it('produces a different key for different status values', () => {
		expect(buildAnchorFactsFilterKey({ status: 404 })).not.toBe(
			buildAnchorFactsFilterKey({ status: 500 }),
		);
	});

	it('produces a different key when status is set vs unset', () => {
		expect(buildAnchorFactsFilterKey({})).not.toBe(
			buildAnchorFactsFilterKey({ status: 404 }),
		);
	});
});
