import { describe, expect, it } from 'vitest';

import { getViewerResourcesSortSpec } from './get-viewer-resources-sort-spec.js';

describe('getViewerResourcesSortSpec', () => {
	it('resolves url asc to a plain ascending keyset on url_sort_key', () => {
		expect(getViewerResourcesSortSpec('url', 'asc')).toEqual({
			columns: ['url_sort_key', 'resource_id'],
			scanDirection: 'asc',
		});
	});

	it('resolves url desc by walking the same columns descending', () => {
		expect(getViewerResourcesSortSpec('url', 'desc')).toEqual({
			columns: ['url_sort_key', 'resource_id'],
			scanDirection: 'desc',
		});
	});

	it('resolves status asc to status_sort_key with an ascending url tie-breaker', () => {
		expect(getViewerResourcesSortSpec('status', 'asc')).toEqual({
			columns: ['status_sort_key', 'url_sort_key', 'resource_id'],
			scanDirection: 'asc',
		});
	});

	it('resolves status desc to status_desc_key, still scanned ascending', () => {
		expect(getViewerResourcesSortSpec('status', 'desc')).toEqual({
			columns: ['status_desc_key', 'url_sort_key', 'resource_id'],
			scanDirection: 'asc',
		});
	});
});
