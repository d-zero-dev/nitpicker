import { describe, expect, it } from 'vitest';

import { buildDuplicateGroupsFilterKey } from './build-duplicate-groups-filter-key.js';

describe('buildDuplicateGroupsFilterKey', () => {
	it('produces different keys for title vs description', () => {
		expect(buildDuplicateGroupsFilterKey({ field: 'title' })).not.toBe(
			buildDuplicateGroupsFilterKey({ field: 'description' }),
		);
	});

	it('produces the same key for the same field across calls', () => {
		expect(buildDuplicateGroupsFilterKey({ field: 'title' })).toBe(
			buildDuplicateGroupsFilterKey({ field: 'title' }),
		);
	});
});
