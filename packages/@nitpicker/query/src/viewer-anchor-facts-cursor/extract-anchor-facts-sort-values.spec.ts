import type { AnchorFactsKeysetRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { extractAnchorFactsSortValues } from './extract-anchor-facts-sort-values.js';

describe('extractAnchorFactsSortValues', () => {
	it('extracts values in spec.columns order, ignoring columns not in the spec', () => {
		const row: AnchorFactsKeysetRow = {
			source_url_sort_key: 'https://example.com/a',
			dest_url_sort_key: 'https://example.com/b',
			status_sort_key: 404,
			status_desc_key: -404,
			edge_id: 7,
		};
		const values = extractAnchorFactsSortValues(
			{
				columns: ['status_sort_key', 'source_url_sort_key', 'edge_id'],
				scanDirection: 'asc',
			},
			row,
		);
		expect(values).toEqual([404, 'https://example.com/a', 7]);
	});
});
