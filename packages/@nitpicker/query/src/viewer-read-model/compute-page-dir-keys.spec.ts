import { describe, expect, it } from 'vitest';

import { computePageDirKeys } from './compute-page-dir-keys.js';

describe('computePageDirKeys', () => {
	it('gives each row its directory key, parent directory key and index flag', () => {
		const dirKeys = computePageDirKeys([
			{ url: 'https://example.com/blog/post' },
			{ url: 'https://example.com/blog/' },
			{ url: 'https://example.com/' },
		]);
		expect(dirKeys.dirKeyAt(0)).toBe('example.com:/blog');
		expect(dirKeys.parentDirKeyAt(0)).toBe('example.com:/');
		expect(dirKeys.isIndexAt(0)).toBe(false);
		expect(dirKeys.dirKeyAt(1)).toBe('example.com:/blog');
		expect(dirKeys.isIndexAt(1)).toBe(true);
		expect(dirKeys.dirKeyAt(2)).toBe('example.com:/');
		expect(dirKeys.isIndexAt(2)).toBe(true);
	});

	it('reports an unparseable URL as having no keys', () => {
		const dirKeys = computePageDirKeys([{ url: 'not a url' }]);
		expect(dirKeys.isParsedAt(0)).toBe(false);
		expect(dirKeys.dirKeyAt(0)).toBeUndefined();
		expect(dirKeys.parentDirKeyAt(0)).toBeUndefined();
		expect(dirKeys.isIndexAt(0)).toBe(false);
	});

	it('keeps the port in the key, so two origins on one host stay apart', () => {
		const dirKeys = computePageDirKeys([
			{ url: 'https://example.com/a/' },
			{ url: 'https://example.com:8443/a/' },
		]);
		expect(dirKeys.dirKeyAt(0)).toBe('example.com:/a');
		expect(dirKeys.dirKeyAt(1)).toBe('example.com:8443/a');
	});

	it('shares one string between rows in the same directory', () => {
		const dirKeys = computePageDirKeys([
			{ url: 'https://example.com/docs/a' },
			{ url: 'https://example.com/docs/b' },
		]);
		expect(dirKeys.dirKeyAt(0)).toBe(dirKeys.dirKeyAt(1));
		// 'example.com:/docs' and 'example.com:/'
		expect(dirKeys.keyCount).toBe(2);
	});

	it('derives the parent key from the path two segments up', () => {
		const dirKeys = computePageDirKeys([
			{ url: 'https://example.com/a/b/c/page' },
			{ url: 'https://example.com/a/b/c/' },
		]);
		// Non-index page: its own directory is /a/b/c, the parent /a/b.
		expect(dirKeys.dirKeyAt(0)).toBe('example.com:/a/b/c');
		expect(dirKeys.parentDirKeyAt(0)).toBe('example.com:/a/b');
		// Index page of /a/b/c/: `paths` ends with an empty segment, so the
		// same rule gives the same parent.
		expect(dirKeys.dirKeyAt(1)).toBe('example.com:/a/b/c');
		expect(dirKeys.parentDirKeyAt(1)).toBe('example.com:/a/b');
	});

	it('is empty for no rows', () => {
		expect(computePageDirKeys([]).keyCount).toBe(0);
	});
});
