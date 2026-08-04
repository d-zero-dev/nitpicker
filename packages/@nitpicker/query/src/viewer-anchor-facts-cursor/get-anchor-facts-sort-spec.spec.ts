import { describe, expect, it } from 'vitest';

import { getAnchorFactsSortSpec } from './get-anchor-facts-sort-spec.js';

describe('getAnchorFactsSortSpec', () => {
	it('sorts by sourceUrl ascending using source_url_ref_id/edge_id, scanned ascending', () => {
		expect(getAnchorFactsSortSpec('sourceUrl', 'asc')).toEqual({
			columns: ['source_url_ref_id', 'edge_id'],
			scanDirection: 'asc',
		});
	});

	it('sorts by sourceUrl descending by flipping the scan direction, no negated key needed', () => {
		expect(getAnchorFactsSortSpec('sourceUrl', 'desc')).toEqual({
			columns: ['source_url_ref_id', 'edge_id'],
			scanDirection: 'desc',
		});
	});

	it('sorts by destUrl ascending using dest_url_ref_id/edge_id, scanned ascending', () => {
		expect(getAnchorFactsSortSpec('destUrl', 'asc')).toEqual({
			columns: ['dest_url_ref_id', 'edge_id'],
			scanDirection: 'asc',
		});
	});

	it('sorts by destUrl descending by flipping the scan direction', () => {
		expect(getAnchorFactsSortSpec('destUrl', 'desc')).toEqual({
			columns: ['dest_url_ref_id', 'edge_id'],
			scanDirection: 'desc',
		});
	});

	it('sorts by status ascending using status_sort_key with a source_url_ref_id tie-breaker, scanned ascending', () => {
		expect(getAnchorFactsSortSpec('status', 'asc')).toEqual({
			columns: ['status_sort_key', 'source_url_ref_id', 'edge_id'],
			scanDirection: 'asc',
		});
	});

	it('sorts by status descending using the negated status_desc_key, ALWAYS scanned ascending', () => {
		expect(getAnchorFactsSortSpec('status', 'desc')).toEqual({
			columns: ['status_desc_key', 'source_url_ref_id', 'edge_id'],
			scanDirection: 'asc',
		});
	});

	it('sorts by isExternal using is_external_link with a source_url_ref_id tie-breaker', () => {
		expect(getAnchorFactsSortSpec('isExternal', 'asc')).toEqual({
			columns: ['is_external_link', 'source_url_ref_id', 'edge_id'],
			scanDirection: 'asc',
		});
		expect(getAnchorFactsSortSpec('isExternal', 'desc')).toEqual({
			columns: ['is_external_link', 'source_url_ref_id', 'edge_id'],
			scanDirection: 'desc',
		});
	});
});
