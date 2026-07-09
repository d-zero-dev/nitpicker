import type { AnchorFactsKeysetRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { extractAnchorFactsSortValues } from './extract-anchor-facts-sort-values.js';

describe('extractAnchorFactsSortValues', () => {
	it('extracts values in spec.columns order, ignoring columns not in the spec', () => {
		const row: AnchorFactsKeysetRow = {
			source_url_ref_id: 1,
			dest_url_ref_id: 2,
			status_sort_key: 404,
			status_desc_key: -404,
			edge_id: 7,
		};
		const values = extractAnchorFactsSortValues(
			{
				columns: ['status_sort_key', 'source_url_ref_id', 'edge_id'],
				scanDirection: 'asc',
			},
			row,
		);
		expect(values).toEqual([404, 1, 7]);
	});
});
