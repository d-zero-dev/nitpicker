import type { DuplicateGroupsKeysetRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { extractDuplicateGroupsSortValues } from './extract-duplicate-groups-sort-values.js';

describe('extractDuplicateGroupsSortValues', () => {
	it('extracts values in spec.columns order', () => {
		const row: DuplicateGroupsKeysetRow = { group_id: 3, count_desc_key: -5 };
		const values = extractDuplicateGroupsSortValues(
			{ columns: ['count_desc_key', 'group_id'], scanDirection: 'asc' },
			row,
		);
		expect(values).toEqual([-5, 3]);
	});
});
