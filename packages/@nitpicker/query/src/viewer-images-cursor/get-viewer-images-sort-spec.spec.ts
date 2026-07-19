import { describe, expect, it } from 'vitest';

import { getViewerImagesSortSpec } from './get-viewer-images-sort-spec.js';

describe('getViewerImagesSortSpec', () => {
	it('resolves pageUrl asc to a plain ascending keyset on page_url_rank', () => {
		expect(getViewerImagesSortSpec('pageUrl', 'asc')).toEqual({
			columns: ['page_url_rank', 'image_id'],
			scanDirection: 'asc',
		});
	});

	it('resolves pageUrl desc by walking the same columns descending', () => {
		expect(getViewerImagesSortSpec('pageUrl', 'desc')).toEqual({
			columns: ['page_url_rank', 'image_id'],
			scanDirection: 'desc',
		});
	});

	it('resolves width to the width column', () => {
		expect(getViewerImagesSortSpec('width', 'asc')).toEqual({
			columns: ['width', 'image_id'],
			scanDirection: 'asc',
		});
	});

	it('resolves height to the height column', () => {
		expect(getViewerImagesSortSpec('height', 'desc')).toEqual({
			columns: ['height', 'image_id'],
			scanDirection: 'desc',
		});
	});

	it('resolves naturalWidth to the natural_width column', () => {
		expect(getViewerImagesSortSpec('naturalWidth', 'asc')).toEqual({
			columns: ['natural_width', 'image_id'],
			scanDirection: 'asc',
		});
	});

	it('resolves naturalHeight to the natural_height column', () => {
		expect(getViewerImagesSortSpec('naturalHeight', 'desc')).toEqual({
			columns: ['natural_height', 'image_id'],
			scanDirection: 'desc',
		});
	});

	it('resolves isLazy to the is_lazy column', () => {
		expect(getViewerImagesSortSpec('isLazy', 'asc')).toEqual({
			columns: ['is_lazy', 'image_id'],
			scanDirection: 'asc',
		});
	});
});
