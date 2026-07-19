import { describe, expect, it } from 'vitest';

import { getViewerUnusedResourcesSortSpec } from './get-viewer-unused-resources-sort-spec.js';

describe('getViewerUnusedResourcesSortSpec', () => {
	it('resolves url asc to a plain ascending keyset on url_sort_key', () => {
		expect(getViewerUnusedResourcesSortSpec('url', 'asc')).toEqual({
			columns: ['url_sort_key', 'resource_id'],
			scanDirection: 'asc',
		});
	});

	it('resolves status asc to status_sort_key with an ascending url tie-breaker', () => {
		expect(getViewerUnusedResourcesSortSpec('status', 'asc')).toEqual({
			columns: ['status_sort_key', 'url_sort_key', 'resource_id'],
			scanDirection: 'asc',
		});
	});

	it('resolves status desc to status_desc_key, still scanned ascending', () => {
		expect(getViewerUnusedResourcesSortSpec('status', 'desc')).toEqual({
			columns: ['status_desc_key', 'url_sort_key', 'resource_id'],
			scanDirection: 'asc',
		});
	});

	it('resolves source asc/desc by walking source + url_sort_key in the same direction', () => {
		expect(getViewerUnusedResourcesSortSpec('source', 'asc')).toEqual({
			columns: ['source', 'url_sort_key', 'resource_id'],
			scanDirection: 'asc',
		});
		expect(getViewerUnusedResourcesSortSpec('source', 'desc')).toEqual({
			columns: ['source', 'url_sort_key', 'resource_id'],
			scanDirection: 'desc',
		});
	});
});
