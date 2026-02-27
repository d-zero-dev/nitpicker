import type { PageData } from '../utils/index.js';
import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import LinkList from './link-list.js';
import { protocolAgnosticKey } from './protocol-agnostic-key.js';

const defaultOptions: ParseURLOptions = {};

/**
 *
 * @param href
 */
function createUrl(href: string): ExURL {
	return parseUrl(href)!;
}

/**
 *
 * @param entries
 */
function createScope(entries: [string, string[]][]): Map<string, ExURL[]> {
	return new Map(
		entries.map(([h, urls]) => [h, urls.map((u) => parseUrl(u)!).filter(Boolean)]),
	);
}

/**
 *
 * @param overrides
 */
function createPageData(overrides: Partial<PageData> = {}): PageData {
	return {
		url: createUrl('https://example.com/page'),
		redirectPaths: [],
		isTarget: true,
		isExternal: false,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 1024,
		responseHeaders: {},
		meta: { title: 'Test' },
		anchorList: [],
		imageList: [],
		html: '<html></html>',
		isSkipped: false,
		...overrides,
	};
}

describe('LinkList', () => {
	describe('add', () => {
		it('adds a new URL to pending', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/page');
			list.add(url);
			const { pending } = list.getLinks();
			expect(pending).toContain(protocolAgnosticKey(url.withoutHashAndAuth));
		});

		it('deduplicates by withoutHashAndAuth', () => {
			const list = new LinkList();
			const url1 = createUrl('https://example.com/page');
			const url2 = createUrl('https://example.com/page');
			list.add(url1);
			list.add(url2);
			const { pending } = list.getLinks();
			expect(pending.length).toBe(1);
		});

		it('does not re-add a URL that is already done', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/page');
			const scope = createScope([['example.com', ['https://example.com/']]]);
			list.add(url);
			list.done(url, scope, { page: createPageData() }, defaultOptions);
			list.add(url);
			const { pending } = list.getLinks();
			expect(pending).not.toContain(protocolAgnosticKey(url.withoutHashAndAuth));
		});

		it('supports metadataOnly flag', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/page');
			list.add(url, { metadataOnly: true });
			expect(list.isMetadataOnly(url.withoutHashAndAuth)).toBe(true);
		});

		it('supports predicted flag', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/page/5');
			list.add(url, { predicted: true });
			expect(list.isPredicted(url.withoutHashAndAuth)).toBe(true);
		});

		it('returns false for isPredicted when flag is not set', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/page/5');
			list.add(url);
			expect(list.isPredicted(url.withoutHashAndAuth)).toBe(false);
		});

		it('metadataOnly and predicted flags are independent', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/page/5');
			list.add(url, { metadataOnly: true, predicted: true });
			expect(list.isMetadataOnly(url.withoutHashAndAuth)).toBe(true);
			expect(list.isPredicted(url.withoutHashAndAuth)).toBe(true);
		});

		it('predicted add on existing URL is a no-op (dedup)', () => {
			const list = new LinkList();
			const url1 = createUrl('https://example.com/page/5');
			const url2 = createUrl('https://example.com/page/5');
			list.add(url1);
			list.add(url2, { predicted: true });
			// predicted flag should not be set since second add was a no-op
			expect(list.isPredicted(url1.withoutHashAndAuth)).toBe(false);
		});

		it('predicted flag is protocol-agnostic', () => {
			const list = new LinkList();
			const httpUrl = createUrl('http://example.com/page/5');
			list.add(httpUrl, { predicted: true });
			const httpsUrl = createUrl('https://example.com/page/5');
			expect(list.isPredicted(httpsUrl.withoutHashAndAuth)).toBe(true);
		});

		it('deduplicates HTTP and HTTPS URLs', () => {
			const list = new LinkList();
			const httpUrl = createUrl('http://example.com/page');
			const httpsUrl = createUrl('https://example.com/page');
			list.add(httpUrl);
			list.add(httpsUrl);
			const { pending } = list.getLinks();
			expect(pending.length).toBe(1);
		});

		it('does not re-add HTTPS URL when HTTP variant is already done', () => {
			const list = new LinkList();
			const httpUrl = createUrl('http://example.com/page');
			const httpsUrl = createUrl('https://example.com/page');
			const scope = createScope([['example.com', ['http://example.com/']]]);
			list.add(httpUrl);
			list.done(httpUrl, scope, { page: createPageData() }, defaultOptions);
			list.add(httpsUrl);
			const { pending } = list.getLinks();
			expect(pending.length).toBe(0);
		});
	});

	describe('progress', () => {
		it('moves URL from pending to progress', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/page');
			list.add(url);
			list.progress(url);
			const { pending, progress } = list.getLinks();
			expect(pending).not.toContain(protocolAgnosticKey(url.withoutHashAndAuth));
			expect(progress).toContain(protocolAgnosticKey(url.withoutHashAndAuth));
		});

		it('is a no-op if URL is not pending', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/page');
			list.progress(url);
			const { pending, progress } = list.getLinks();
			expect(pending.length).toBe(0);
			expect(progress.length).toBe(0);
		});
	});

	describe('done', () => {
		it('creates a Link with dest from page data', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/page');
			const scope = createScope([['example.com', ['https://example.com/']]]);
			list.add(url);
			const page = createPageData();
			const link = list.done(url, scope, { page }, defaultOptions);
			expect(link).not.toBeNull();
			expect(link!.dest).toBeDefined();
			expect(link!.dest!.status).toBe(200);
			expect(link!.dest!.title).toBe('Test');
		});

		it('sets isExternal=true when hostname not in scope', () => {
			const list = new LinkList();
			const url = createUrl('https://external.com/page');
			const scope = createScope([['example.com', ['https://example.com/']]]);
			list.add(url);
			const link = list.done(url, scope, { page: createPageData() }, defaultOptions);
			expect(link).not.toBeNull();
			expect(link!.isExternal).toBe(true);
		});

		it('sets isLowerLayer based on scope matching', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/blog/post');
			const scope = createScope([['example.com', ['https://example.com/blog/']]]);
			list.add(url);
			const link = list.done(url, scope, { page: createPageData() }, defaultOptions);
			expect(link).not.toBeNull();
			expect(link!.isLowerLayer).toBe(true);
		});

		it('increments completePages for valid internal HTML pages', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/blog/post');
			const scope = createScope([['example.com', ['https://example.com/']]]);
			list.add(url);
			list.done(
				url,
				scope,
				{
					page: createPageData({
						status: 200,
						contentType: 'text/html',
					}),
				},
				defaultOptions,
			);
			expect(list.completePages).toBe(1);
		});

		it('does not count error pages as completePages', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/page');
			const scope = createScope([['example.com', ['https://example.com/']]]);
			list.add(url);
			list.done(
				url,
				scope,
				{
					page: createPageData({ status: 404, statusText: 'Not Found' }),
				},
				defaultOptions,
			);
			expect(list.completePages).toBe(0);
		});

		it('handles error resource with ERR_NAME_NOT_RESOLVED', () => {
			const list = new LinkList();
			const url = createUrl('https://nonexistent.example.com/page');
			const scope = createScope([
				['nonexistent.example.com', ['https://nonexistent.example.com/']],
			]);
			list.add(url);
			const link = list.done(
				url,
				scope,
				{ error: new Error('net::ERR_NAME_NOT_RESOLVED') },
				defaultOptions,
			);
			expect(link).not.toBeNull();
			expect(link!.dest).toBeDefined();
			expect(link!.dest!.status).toBe(-1);
			expect(link!.dest!.statusText).toBe('net::ERR_NAME_NOT_RESOLVED');
		});

		it('adds redirectPaths to done set', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/start');
			const scope = createScope([['example.com', ['https://example.com/']]]);
			list.add(url);
			const page = createPageData({
				redirectPaths: ['https://example.com/redirected'],
			});
			list.done(url, scope, { page }, defaultOptions);
			// The redirect path should be in done set, so adding it again should be a no-op
			const redirectUrl = createUrl('https://example.com/redirected');
			list.add(redirectUrl);
			const { pending } = list.getLinks();
			expect(pending).not.toContain(protocolAgnosticKey(redirectUrl.withoutHashAndAuth));
		});

		it('returns null if URL was not added', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/unknown');
			const scope = createScope([['example.com', ['https://example.com/']]]);
			const link = list.done(url, scope, { page: createPageData() }, defaultOptions);
			expect(link).toBeNull();
		});

		it('sets dest with status -1 for ERR_NAME_NOT_RESOLVED errors', () => {
			const list = new LinkList();
			const url = createUrl('https://example.com/page');
			const scope = createScope([['example.com', ['https://example.com/']]]);
			list.add(url);
			const link = list.done(
				url,
				scope,
				{ error: new Error('ERR_NAME_NOT_RESOLVED at something') },
				defaultOptions,
			);
			expect(link).not.toBeNull();
			expect(link!.dest).toEqual({
				redirectPaths: [],
				status: -1,
				statusText: 'ERR_NAME_NOT_RESOLVED at something',
				contentType: null,
				contentLength: null,
				responseHeaders: {},
			});
		});
	});

	describe('getPageCount', () => {
		it('returns correct counts', () => {
			const list = new LinkList();
			const url1 = createUrl('https://example.com/page1');
			const url2 = createUrl('https://example.com/page2');
			const scope = createScope([['example.com', ['https://example.com/']]]);
			list.add(url1);
			list.add(url2);
			list.done(
				url1,
				scope,
				{
					page: createPageData({ status: 200, contentType: 'text/html' }),
				},
				defaultOptions,
			);

			const counts = list.getPageCount();
			expect(counts.totalLinks).toBe(2);
			expect(counts.completedLinks).toBe(1);
			expect(counts.completedPages).toBe(1);
		});
	});

	describe('resume', () => {
		it('restores pending and done URLs', () => {
			const list = new LinkList();
			list.resume(
				['https://example.com/pending1'],
				['https://example.com/done1'],
				defaultOptions,
			);

			// pending URLs are added to pending and also to done
			const { pending } = list.getLinks();
			expect(pending.length).toBe(1);

			// done URLs should be marked as done, so adding again is a no-op
			const doneUrl = createUrl('https://example.com/done1');
			list.add(doneUrl);
			const { pending: afterAdd } = list.getLinks();
			expect(afterAdd).not.toContain(protocolAgnosticKey(doneUrl.withoutHashAndAuth));
		});
	});
});
