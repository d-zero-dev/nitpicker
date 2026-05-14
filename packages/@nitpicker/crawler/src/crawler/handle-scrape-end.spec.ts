import type { CrawlerOptions } from './types.js';
import type { AnchorData, PageData } from '../utils/types/types.js';
import type { ExURL } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect, vi } from 'vitest';

import { handleScrapeEnd } from './handle-scrape-end.js';

const defaultOptions: CrawlerOptions = {
	interval: 0,
	parallels: 1,
	recursive: true,
	fromList: false,
	captureImages: false,
	executablePath: null,
	fetchExternal: false,
	scope: ['https://example.com/'],
	excludes: [],
	excludeKeywords: [],
	excludeUrls: [],
	maxExcludedDepth: 0,
	retry: 0,
	verbose: false,
	disableQueries: false,
};

/**
 * @param overrides - Partial overrides merged into the default mock PageData.
 */
function createMockResult(overrides?: Partial<PageData>): PageData {
	return {
		url: parseUrl('https://example.com/page')!,
		isTarget: true,
		isExternal: false,
		redirectPaths: [],
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 1000,
		responseHeaders: {},
		meta: { title: 'Test' },
		imageList: [],
		anchorList: [] as AnchorData[],
		html: '<html></html>',
		isSkipped: false,
		...overrides,
	};
}

/**
 * Construct an anchor data fixture for a given href.
 * @param href - Anchor target URL string.
 * @returns A minimally-populated {@link AnchorData}.
 */
function makeAnchor(href: string): AnchorData {
	return { href: parseUrl(href)!, textContent: '' } as AnchorData;
}

/**
 * Construct a scope map keyed by hostname from URL strings.
 * @param urls - Scope URL strings.
 * @returns Hostname-indexed scope map.
 */
function buildScope(urls: string[]): Map<string, ExURL[]> {
	const map = new Map<string, ExURL[]>();
	for (const raw of urls) {
		const parsed = parseUrl(raw)!;
		const existing = map.get(parsed.hostname) ?? [];
		map.set(parsed.hostname, [...existing, parsed]);
	}
	return map;
}

describe('handleScrapeEnd', () => {
	it('marks URL as done in the link list', () => {
		const result = createMockResult();
		const mockLink = { url: result.url, isExternal: false, isLowerLayer: false };
		const linkList = {
			done: vi.fn().mockReturnValue(mockLink),
			isMetadataOnly: vi.fn().mockReturnValue(false),
		};
		const scope = buildScope(['https://example.com/']);
		const addUrl = vi.fn();

		const { link, isExternal } = handleScrapeEnd(
			result,
			linkList as never,
			scope,
			defaultOptions,
			addUrl,
		);

		expect(linkList.done).toHaveBeenCalledOnce();
		expect(link).toBe(mockLink);
		expect(isExternal).toBe(false);
	});

	it('skips anchor processing in title-only mode', () => {
		const result = createMockResult({
			anchorList: [makeAnchor('https://example.com/other')],
		});
		const linkList = {
			done: vi.fn().mockReturnValue(null),
			isMetadataOnly: vi.fn().mockReturnValue(true),
		};
		const scope = buildScope(['https://example.com/']);
		const addUrl = vi.fn();

		handleScrapeEnd(result, linkList as never, scope, defaultOptions, addUrl);

		expect(addUrl).not.toHaveBeenCalled();
	});

	it('returns isExternal: true for external pages', () => {
		const result = createMockResult({ isExternal: true });
		const linkList = {
			done: vi.fn().mockReturnValue(null),
			isMetadataOnly: vi.fn().mockReturnValue(false),
		};
		const scope = new Map();
		const addUrl = vi.fn();

		const { isExternal } = handleScrapeEnd(
			result,
			linkList as never,
			scope,
			defaultOptions,
			addUrl,
		);

		expect(isExternal).toBe(true);
	});

	describe('processAnchors scope semantics', () => {
		it('enqueues "hostname match × path inside scope" anchor for full scrape', () => {
			const result = createMockResult({
				anchorList: [makeAnchor('https://example.com/blog/post/1')],
			});
			const linkList = {
				done: vi.fn().mockReturnValue(null),
				isMetadataOnly: vi.fn().mockReturnValue(false),
			};
			const scope = buildScope(['https://example.com/blog/']);
			const addUrl = vi.fn();

			handleScrapeEnd(
				result,
				linkList as never,
				scope,
				{ ...defaultOptions, scope: ['https://example.com/blog/'] },
				addUrl,
			);

			expect(addUrl).toHaveBeenCalledTimes(1);
			expect(addUrl).toHaveBeenCalledWith(
				expect.objectContaining({ pathname: '/blog/post/1' }),
			);
			expect(addUrl).not.toHaveBeenCalledWith(expect.anything(), {
				metadataOnly: true,
			});
		});

		it('enqueues "hostname match × path outside scope" anchor as metadata-only when fetchExternal=true', () => {
			const result = createMockResult({
				anchorList: [makeAnchor('https://example.com/about')],
			});
			const linkList = {
				done: vi.fn().mockReturnValue(null),
				isMetadataOnly: vi.fn().mockReturnValue(false),
			};
			const scope = buildScope(['https://example.com/blog/']);
			const addUrl = vi.fn();

			handleScrapeEnd(
				result,
				linkList as never,
				scope,
				{ ...defaultOptions, scope: ['https://example.com/blog/'], fetchExternal: true },
				addUrl,
			);

			expect(addUrl).toHaveBeenCalledTimes(1);
			expect(addUrl).toHaveBeenCalledWith(
				expect.objectContaining({ pathname: '/about' }),
				{ metadataOnly: true },
			);
		});

		it('does NOT enqueue "hostname match × path outside scope" anchor when fetchExternal=false', () => {
			const result = createMockResult({
				anchorList: [makeAnchor('https://example.com/about')],
			});
			const linkList = {
				done: vi.fn().mockReturnValue(null),
				isMetadataOnly: vi.fn().mockReturnValue(false),
			};
			const scope = buildScope(['https://example.com/blog/']);
			const addUrl = vi.fn();

			handleScrapeEnd(
				result,
				linkList as never,
				scope,
				{ ...defaultOptions, scope: ['https://example.com/blog/'], fetchExternal: false },
				addUrl,
			);

			expect(addUrl).not.toHaveBeenCalled();
		});

		it('inherits auth credentials from the matched scope into in-scope anchors', () => {
			const anchor = makeAnchor('https://example.com/blog/post');
			const result = createMockResult({ anchorList: [anchor] });
			const linkList = {
				done: vi.fn().mockReturnValue(null),
				isMetadataOnly: vi.fn().mockReturnValue(false),
			};
			const scope = buildScope(['https://user:pass@example.com/blog/']);
			const addUrl = vi.fn();

			handleScrapeEnd(
				result,
				linkList as never,
				scope,
				{ ...defaultOptions, scope: ['https://user:pass@example.com/blog/'] },
				addUrl,
			);

			expect(anchor.href.username).toBe('user');
			expect(anchor.href.password).toBe('pass');
		});

		it('does NOT inject auth into out-of-scope anchors', () => {
			const anchor = makeAnchor('https://example.com/about');
			const result = createMockResult({ anchorList: [anchor] });
			const linkList = {
				done: vi.fn().mockReturnValue(null),
				isMetadataOnly: vi.fn().mockReturnValue(false),
			};
			const scope = buildScope(['https://user:pass@example.com/blog/']);
			const addUrl = vi.fn();

			handleScrapeEnd(
				result,
				linkList as never,
				scope,
				{
					...defaultOptions,
					scope: ['https://user:pass@example.com/blog/'],
					fetchExternal: true,
				},
				addUrl,
			);

			expect(anchor.href.username).toBeNull();
			expect(anchor.href.password).toBeNull();
		});

		it('enqueues every anchor as metadata-only in non-recursive mode regardless of scope', () => {
			const result = createMockResult({
				anchorList: [
					makeAnchor('https://example.com/blog/post'),
					makeAnchor('https://example.com/about'),
					makeAnchor('https://other.com/foo'),
				],
			});
			const linkList = {
				done: vi.fn().mockReturnValue(null),
				isMetadataOnly: vi.fn().mockReturnValue(false),
			};
			const scope = buildScope(['https://example.com/blog/']);
			const addUrl = vi.fn();

			handleScrapeEnd(
				result,
				linkList as never,
				scope,
				{ ...defaultOptions, scope: ['https://example.com/blog/'], recursive: false },
				addUrl,
			);

			expect(addUrl).toHaveBeenCalledTimes(3);
			for (const call of addUrl.mock.calls) {
				expect(call[1]).toEqual({ metadataOnly: true });
			}
		});
	});
});
