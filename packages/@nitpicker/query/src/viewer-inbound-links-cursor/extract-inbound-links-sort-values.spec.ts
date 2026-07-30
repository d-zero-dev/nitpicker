import type { InboundLinksKeysetRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { extractInboundLinksSortValues } from './extract-inbound-links-sort-values.js';

describe('extractInboundLinksSortValues', () => {
	it('extracts values in spec.columns order', () => {
		const row: InboundLinksKeysetRow = { edge_id: 7 };
		const values = extractInboundLinksSortValues(
			{ columns: ['edge_id'], scanDirection: 'asc' },
			row,
		);
		expect(values).toEqual([7]);
	});
});
