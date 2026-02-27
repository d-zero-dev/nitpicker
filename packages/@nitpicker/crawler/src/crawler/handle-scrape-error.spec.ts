import type { CrawlerOptions } from './types.js';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { handleScrapeError } from './handle-scrape-error.js';
import LinkList from './link-list.js';

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
	maxExcludedDepth: 10,
	retry: 3,
	verbose: false,
	disableQueries: false,
};

/**
 * Create a scope map for testing.
 * @returns A scope map with example.com.
 */
function createScope() {
	return new Map([['example.com', [parseUrl('https://example.com/')!]]]);
}

describe('handleScrapeError', () => {
	it('marks the URL as done when shutdown is true', () => {
		const linkList = new LinkList();
		const url = parseUrl('https://example.com/page')!;
		const scope = createScope();
		linkList.add(url);
		linkList.progress(url);

		const { link, result } = handleScrapeError(
			{
				url,
				error: { name: 'Error', message: 'Browser crashed' },
				shutdown: true,
				pid: 1234,
			},
			linkList,
			scope,
			defaultOptions,
		);

		expect(link).not.toBeNull();
		expect(link!.url.href).toBe(url.href);
		expect(result).toBeDefined();
		expect(result!.status).toBe(-1);
	});

	it('marks the URL as done when shutdown is false', () => {
		const linkList = new LinkList();
		const url = parseUrl('https://example.com/page')!;
		const scope = createScope();
		linkList.add(url);
		linkList.progress(url);

		const { link, result } = handleScrapeError(
			{
				url,
				error: { name: 'Error', message: 'ERR_NAME_NOT_RESOLVED' },
				shutdown: false,
				pid: 5678,
			},
			linkList,
			scope,
			defaultOptions,
		);

		expect(link).not.toBeNull();
		expect(link!.url.href).toBe(url.href);
		expect(result).toBeDefined();
		expect(result!.status).toBe(-1);
	});

	it('returns null link when url is null', () => {
		const linkList = new LinkList();
		const scope = createScope();

		const { link, result } = handleScrapeError(
			{
				url: null,
				error: { name: 'Error', message: 'Unknown error' },
				shutdown: true,
				pid: undefined,
			},
			linkList,
			scope,
			defaultOptions,
		);

		expect(link).toBeNull();
		expect(result).toBeUndefined();
	});
});
