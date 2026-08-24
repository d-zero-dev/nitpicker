import type { DisplayTitleSourceRow } from './compute-display-title-by-page-id.js';

import { describe, expect, it } from 'vitest';

import { computeDisplayTitleByPageId } from './compute-display-title-by-page-id.js';

/**
 *
 * @param id
 * @param url
 * @param title
 */
function row(id: number, url: string, title: string | null): DisplayTitleSourceRow {
	return { id, url, title };
}

describe('computeDisplayTitleByPageId', () => {
	it('strips the directory index title from a child page title', () => {
		const rows = [
			row(1, 'https://example.com/blog/', 'My Blog | Example Site'),
			row(2, 'https://example.com/blog/post-1', 'Post 1 | My Blog | Example Site'),
		];
		const result = computeDisplayTitleByPageId(rows);
		expect(result.get(2)).toBe('Post 1');
	});

	it('is independent of scan order — the index page can come after the child in the row list', () => {
		const rows = [
			row(2, 'https://example.com/blog/post-1', 'Post 1 | My Blog | Example Site'),
			row(1, 'https://example.com/blog/', 'My Blog | Example Site'),
		];
		const result = computeDisplayTitleByPageId(rows);
		expect(result.get(2)).toBe('Post 1');
	});

	it('falls back to the parent directory index title for an index page itself', () => {
		const rows = [
			row(1, 'https://example.com/', 'Example Site'),
			row(2, 'https://example.com/blog/', 'Blog | Example Site'),
		];
		const result = computeDisplayTitleByPageId(rows);
		expect(result.get(2)).toBe('Blog');
	});

	it('leaves the title untouched when no directory index title matches', () => {
		const rows = [row(1, 'https://example.com/about', 'About Us')];
		const result = computeDisplayTitleByPageId(rows);
		expect(result.get(1)).toBe('About Us');
	});

	it('falls back to the full title when stripping would leave an empty string', () => {
		const rows = [
			row(1, 'https://example.com/blog/', 'My Blog'),
			row(2, 'https://example.com/blog/post-1', 'My Blog'),
		];
		const result = computeDisplayTitleByPageId(rows);
		expect(result.get(2)).toBe('My Blog');
	});

	it('maps a null title to null', () => {
		const rows = [row(1, 'https://example.com/about', null)];
		const result = computeDisplayTitleByPageId(rows);
		expect(result.get(1)).toBeNull();
	});

	it('maps an unparseable URL to the title verbatim', () => {
		const rows = [row(1, 'not a url', 'Some Title')];
		const result = computeDisplayTitleByPageId(rows);
		expect(result.get(1)).toBe('Some Title');
	});

	it('does not strip a same-path index title from a different origin in a multi-root archive', () => {
		const rows = [
			row(1, 'https://site-a.example/blog/', 'Blog A | Site A'),
			row(2, 'https://site-b.example/blog/post-1', 'Post 1 | Blog A | Site A'),
		];
		const result = computeDisplayTitleByPageId(rows);
		// site-b's page never shares an origin with site-a's index title, so
		// nothing matches and the title is left untouched.
		expect(result.get(2)).toBe('Post 1 | Blog A | Site A');
	});
});
