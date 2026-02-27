import type { CrawlerOptions } from './types.js';
import type { AnchorData, PageData } from '../utils/index.js';

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
 *
 * @param overrides
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

describe('handleScrapeEnd', () => {
	it('marks URL as done in the link list', () => {
		const result = createMockResult();
		const mockLink = { url: result.url, isExternal: false, isLowerLayer: false };
		const linkList = {
			done: vi.fn().mockReturnValue(mockLink),
			isMetadataOnly: vi.fn().mockReturnValue(false),
		};
		const scope = new Map([['example.com', [parseUrl('https://example.com/')!]]]);
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
		const anchor = { href: parseUrl('https://example.com/other')!, textContent: 'link' };
		const result = createMockResult({ anchorList: [anchor as AnchorData] });
		const linkList = {
			done: vi.fn().mockReturnValue(null),
			isMetadataOnly: vi.fn().mockReturnValue(true),
		};
		const scope = new Map([['example.com', [parseUrl('https://example.com/')!]]]);
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
});
