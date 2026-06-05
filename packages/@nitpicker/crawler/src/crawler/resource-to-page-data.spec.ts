import type { ResourceLookupResult } from './types.js';

import { parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { resourceToPageData } from './resource-to-page-data.js';

const url = parseUrl('https://example.com/image.jpg');

/**
 * Build a ResourceLookupResult with sensible defaults for tests.
 * @param overrides - Fields to override.
 * @returns A complete ResourceLookupResult.
 */
function createResource(
	overrides: Partial<ResourceLookupResult> = {},
): ResourceLookupResult {
	return {
		status: 200,
		statusText: 'OK',
		contentType: 'image/jpeg',
		contentLength: 1234,
		responseHeaders: { 'content-type': 'image/jpeg' },
		...overrides,
	};
}

describe('resourceToPageData', () => {
	it('synthesizes PageData from a 2xx non-HTML resource', () => {
		const result = resourceToPageData({
			url,
			isExternal: false,
			resource: createResource(),
		});
		expect(result).not.toBeNull();
		expect(result?.url).toBe(url);
		expect(result?.isTarget).toBe(true);
		expect(result?.isExternal).toBe(false);
		expect(result?.status).toBe(200);
		expect(result?.statusText).toBe('OK');
		expect(result?.contentType).toBe('image/jpeg');
		expect(result?.contentLength).toBe(1234);
		expect(result?.responseHeaders).toEqual({ 'content-type': 'image/jpeg' });
		expect(result?.redirectPaths).toEqual([]);
		expect(result?.meta).toEqual({ title: '' });
		expect(result?.anchorList).toEqual([]);
		expect(result?.imageList).toEqual([]);
		expect(result?.html).toBe('');
		expect(result?.isSkipped).toBe(false);
	});

	it('reflects the external flag', () => {
		const result = resourceToPageData({
			url,
			isExternal: true,
			resource: createResource(),
		});
		expect(result?.isExternal).toBe(true);
		expect(result?.isTarget).toBe(false);
	});

	it('returns null when status is null', () => {
		const result = resourceToPageData({
			url,
			isExternal: false,
			resource: createResource({ status: null }),
		});
		expect(result).toBeNull();
	});

	it.each([301, 304, 404, 500, 199])('returns null for non-2xx status %d', (status) => {
		const result = resourceToPageData({
			url,
			isExternal: false,
			resource: createResource({ status }),
		});
		expect(result).toBeNull();
	});

	it.each([200, 204, 206, 299])('accepts 2xx status %d', (status) => {
		const result = resourceToPageData({
			url,
			isExternal: false,
			resource: createResource({ status }),
		});
		expect(result?.status).toBe(status);
	});

	it('returns null when contentType is null', () => {
		const result = resourceToPageData({
			url,
			isExternal: false,
			resource: createResource({ contentType: null }),
		});
		expect(result).toBeNull();
	});

	it('returns null when contentType is text/html', () => {
		const result = resourceToPageData({
			url,
			isExternal: false,
			resource: createResource({ contentType: 'text/html' }),
		});
		expect(result).toBeNull();
	});

	it.each(['text/HTML', 'TEXT/HTML', 'Text/Html'])(
		'returns null for HTML contentType in any letter case (%s)',
		(contentType) => {
			const result = resourceToPageData({
				url,
				isExternal: false,
				resource: createResource({ contentType }),
			});
			expect(result).toBeNull();
		},
	);

	it('normalizes null statusText and contentLength', () => {
		const result = resourceToPageData({
			url,
			isExternal: false,
			resource: createResource({
				statusText: null,
				contentLength: null,
				responseHeaders: null,
			}),
		});
		expect(result?.statusText).toBe('');
		expect(result?.contentLength).toBeNull();
		expect(result?.responseHeaders).toBeNull();
	});
});
