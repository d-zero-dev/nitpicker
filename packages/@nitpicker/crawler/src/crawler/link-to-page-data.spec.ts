import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { linkToPageData } from './link-to-page-data.js';

/**
 *
 * @param overrides
 */
function createLink(overrides: Record<string, unknown> = {}) {
	const url = parseUrl('https://example.com/page')!;
	return {
		url,
		isExternal: false,
		isLowerLayer: true,
		...overrides,
	};
}

describe('linkToPageData', () => {
	it('converts link without dest to default PageData', () => {
		const link = createLink();
		const result = linkToPageData(link);
		expect(result.url).toBe(link.url);
		expect(result.status).toBe(-1);
		expect(result.statusText).toBe('UnknownError');
		expect(result.contentType).toBeNull();
		expect(result.contentLength).toBeNull();
		expect(result.responseHeaders).toBeNull();
		expect(result.redirectPaths).toStrictEqual([]);
		expect(result.meta.title).toBe('');
		expect(result.anchorList).toStrictEqual([]);
		expect(result.imageList).toStrictEqual([]);
		expect(result.html).toBe('');
		expect(result.isSkipped).toBe(false);
	});

	it('sets isTarget=true for internal link', () => {
		const link = createLink({ isExternal: false });
		const result = linkToPageData(link);
		expect(result.isTarget).toBe(true);
		expect(result.isExternal).toBe(false);
	});

	it('sets isTarget=false for external link', () => {
		const link = createLink({ isExternal: true });
		const result = linkToPageData(link);
		expect(result.isTarget).toBe(false);
		expect(result.isExternal).toBe(true);
	});

	it('uses dest data when available', () => {
		const link = createLink({
			dest: {
				redirectPaths: ['/redirect'],
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 1024,
				responseHeaders: { 'content-type': 'text/html' },
				title: 'Test Page',
			},
		});
		const result = linkToPageData(link);
		expect(result.status).toBe(200);
		expect(result.statusText).toBe('OK');
		expect(result.contentType).toBe('text/html');
		expect(result.contentLength).toBe(1024);
		expect(result.redirectPaths).toStrictEqual(['/redirect']);
		expect(result.meta.title).toBe('Test Page');
	});

	it('uses dest title when provided', () => {
		const link = createLink({
			dest: {
				redirectPaths: [],
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 0,
				responseHeaders: {},
				title: 'My Title',
			},
		});
		const result = linkToPageData(link);
		expect(result.meta.title).toBe('My Title');
	});

	it('falls back to empty title when dest has no title', () => {
		const link = createLink({
			dest: {
				redirectPaths: [],
				status: 200,
				statusText: 'OK',
				contentType: null,
				contentLength: null,
				responseHeaders: null,
			},
		});
		const result = linkToPageData(link);
		expect(result.meta.title).toBe('');
	});

	it('records current behavior: status 0 becomes -1 via || operator', () => {
		const link = createLink({
			dest: {
				redirectPaths: [],
				status: 0,
				statusText: 'OK',
				contentType: null,
				contentLength: null,
				responseHeaders: null,
			},
		});
		const result = linkToPageData(link);
		expect(result.status).toBe(-1);
	});

	it('records current behavior: contentLength 0 becomes null via || operator', () => {
		const link = createLink({
			dest: {
				redirectPaths: [],
				status: 200,
				statusText: 'OK',
				contentType: null,
				contentLength: 0,
				responseHeaders: null,
			},
		});
		const result = linkToPageData(link);
		expect(result.contentLength).toBeNull();
	});
});
