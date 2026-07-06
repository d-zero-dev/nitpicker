import { describe, expect, it } from 'vitest';

import { buildDuplicateGroupPagesFilterKey } from './build-duplicate-group-pages-filter-key.js';

describe('buildDuplicateGroupPagesFilterKey', () => {
	it('produces different keys for different groupIds', () => {
		expect(buildDuplicateGroupPagesFilterKey({ groupId: 1 })).not.toBe(
			buildDuplicateGroupPagesFilterKey({ groupId: 2 }),
		);
	});

	it('produces the same key for the same groupId across calls', () => {
		expect(buildDuplicateGroupPagesFilterKey({ groupId: 1 })).toBe(
			buildDuplicateGroupPagesFilterKey({ groupId: 1 }),
		);
	});
});
