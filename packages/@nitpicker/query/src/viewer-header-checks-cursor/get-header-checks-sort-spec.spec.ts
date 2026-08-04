import { describe, expect, it } from 'vitest';

import { getHeaderChecksSortSpec } from './get-header-checks-sort-spec.js';

describe('getHeaderChecksSortSpec', () => {
	it('urlBinary sorts on url_sort_key/page_id, scanned ascending', () => {
		expect(getHeaderChecksSortSpec('urlBinary', 'asc')).toEqual({
			columns: ['url_sort_key', 'page_id'],
			scanDirection: 'asc',
		});
	});

	it('sorts descending by flipping the scan direction, no negated key needed', () => {
		expect(getHeaderChecksSortSpec('urlBinary', 'desc')).toEqual({
			columns: ['url_sort_key', 'page_id'],
			scanDirection: 'desc',
		});
	});

	it('urlNatural sorts on natural_url_rank/page_id', () => {
		expect(getHeaderChecksSortSpec('urlNatural', 'asc')).toEqual({
			columns: ['natural_url_rank', 'page_id'],
			scanDirection: 'asc',
		});
	});

	it('maps each header-flag sort to its boolean column', () => {
		expect(getHeaderChecksSortSpec('hasCSP', 'asc').columns).toEqual([
			'has_csp',
			'page_id',
		]);
		expect(getHeaderChecksSortSpec('hasXFrameOptions', 'asc').columns).toEqual([
			'has_x_frame_options',
			'page_id',
		]);
		expect(getHeaderChecksSortSpec('hasXContentTypeOptions', 'asc').columns).toEqual([
			'has_x_content_type_options',
			'page_id',
		]);
		expect(getHeaderChecksSortSpec('hasHSTS', 'desc')).toEqual({
			columns: ['has_hsts', 'page_id'],
			scanDirection: 'desc',
		});
	});
});
