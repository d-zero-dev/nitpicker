import { describe, expect, it } from 'vitest';

import { getViewerPagesSortSpec } from './get-viewer-pages-sort-spec.js';

describe('getViewerPagesSortSpec', () => {
	it('sorts by url ascending using url_sort_key/page_id, scanned ascending', () => {
		expect(getViewerPagesSortSpec('url', 'asc')).toEqual({
			columns: ['url_sort_key', 'page_id'],
			scanDirection: 'asc',
		});
	});

	it('sorts by url descending using the same columns, scanned descending', () => {
		expect(getViewerPagesSortSpec('url', 'desc')).toEqual({
			columns: ['url_sort_key', 'page_id'],
			scanDirection: 'desc',
		});
	});

	it('sorts by title using title_sort_key with url_sort_key/page_id tie-breakers, same-direction scan', () => {
		expect(getViewerPagesSortSpec('title', 'asc')).toEqual({
			columns: ['title_sort_key', 'url_sort_key', 'page_id'],
			scanDirection: 'asc',
		});
		expect(getViewerPagesSortSpec('title', 'desc')).toEqual({
			columns: ['title_sort_key', 'url_sort_key', 'page_id'],
			scanDirection: 'desc',
		});
	});

	it('sorts by status ascending using status_sort_key, scanned ascending', () => {
		expect(getViewerPagesSortSpec('status', 'asc')).toEqual({
			columns: ['status_sort_key', 'url_sort_key', 'page_id'],
			scanDirection: 'asc',
		});
	});

	it('sorts by status descending using the negated status_desc_key, ALWAYS scanned ascending', () => {
		// status_desc_key = -status_sort_key, so walking it ascending yields
		// status descending while keeping the url/page_id tie-breakers ascending
		// too — ties display in URL order regardless of primary direction.
		expect(getViewerPagesSortSpec('status', 'desc')).toEqual({
			columns: ['status_desc_key', 'url_sort_key', 'page_id'],
			scanDirection: 'asc',
		});
	});
});
