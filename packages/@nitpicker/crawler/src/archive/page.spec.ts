import type { DB_Anchor, DB_Page, DB_Redirect, DB_Referrer } from './types.js';

import { describe, it, expect, vi } from 'vitest';

import Page from './page.js';

/**
 * Create a mock ArchiveAccessor with vi.fn() stubs.
 * @param overrides - Optional method overrides.
 * @returns A mock ArchiveAccessor.
 */
function createMockArchive(overrides: Record<string, unknown> = {}) {
	return {
		getAnchorsOnPage: vi.fn().mockResolvedValue([]),
		getHtmlOfPage: vi.fn().mockResolvedValue(null),
		getReferrersOfPage: vi.fn().mockResolvedValue([]),
		...overrides,
	};
}

/**
 * Create a minimal DB_Page fixture with sensible defaults.
 * @param overrides - Optional field overrides.
 * @returns A DB_Page object.
 */
function createRawPage(overrides: Partial<DB_Page> = {}): DB_Page {
	return {
		id: 1,
		url: 'https://example.com/',
		redirectDestId: null,
		scraped: 1,
		isTarget: 1,
		isExternal: 0,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 5000,
		responseHeaders: '{"content-type":"text/html"}',
		lang: 'ja',
		title: 'Example Page',
		description: 'A test page',
		keywords: 'test,example',
		noindex: 0,
		nofollow: 0,
		noarchive: 0,
		canonical: 'https://example.com/',
		alternate: null,
		og_type: 'website',
		og_title: 'Example',
		og_site_name: 'Example Site',
		og_description: 'OG description',
		og_url: 'https://example.com/',
		og_image: 'https://example.com/image.png',
		twitter_card: 'summary',
		networkLogs: null,
		html: 'pages/1.html',
		isSkipped: 0,
		skipReason: null,
		order: 0,
		...overrides,
	};
}

describe('Page', () => {
	describe('getters', () => {
		it('returns url as ExURL', () => {
			const page = new Page(createMockArchive() as never, createRawPage());
			expect(page.url.href).toBe('https://example.com');
		});

		it('returns title from raw data', () => {
			const page = new Page(createMockArchive() as never, createRawPage());
			expect(page.title).toBe('Example Page');
		});

		it('returns empty string for null title', () => {
			const page = new Page(createMockArchive() as never, createRawPage({ title: null }));
			expect(page.title).toBe('');
		});

		it('returns status from raw data', () => {
			const page = new Page(createMockArchive() as never, createRawPage());
			expect(page.status).toBe(200);
		});

		it('returns isExternal as false when flag is 0', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ isExternal: 0 }),
			);
			expect(page.isExternal).toBe(false);
		});

		it('returns isExternal as true when flag is 1', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ isExternal: 1 }),
			);
			expect(page.isExternal).toBe(true);
		});

		it('returns isSkipped as false when flag is 0', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ isSkipped: 0 }),
			);
			expect(page.isSkipped).toBe(false);
		});

		it('returns isSkipped as true when flag is 1', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ isSkipped: 1 }),
			);
			expect(page.isSkipped).toBe(true);
		});

		it('returns skipReason from raw data', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ isSkipped: 1, skipReason: 'blocked by robots.txt' }),
			);
			expect(page.skipReason).toBe('blocked by robots.txt');
		});

		it('returns null skipReason for non-skipped pages', () => {
			const page = new Page(createMockArchive() as never, createRawPage());
			expect(page.skipReason).toBeNull();
		});

		it('returns isTarget as boolean', () => {
			const page = new Page(createMockArchive() as never, createRawPage({ isTarget: 1 }));
			expect(page.isTarget).toBe(true);
		});

		it('returns noindex/nofollow/noarchive as booleans', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ noindex: 1, nofollow: 1, noarchive: 1 }),
			);
			expect(page.noindex).toBe(true);
			expect(page.nofollow).toBe(true);
			expect(page.noarchive).toBe(true);
		});

		it('returns og_* and twitter_card from raw data', () => {
			const page = new Page(createMockArchive() as never, createRawPage());
			expect(page.og_type).toBe('website');
			expect(page.og_title).toBe('Example');
			expect(page.og_site_name).toBe('Example Site');
			expect(page.og_description).toBe('OG description');
			expect(page.og_url).toBe('https://example.com/');
			expect(page.og_image).toBe('https://example.com/image.png');
			expect(page.twitter_card).toBe('summary');
		});

		it('parses responseHeaders from JSON string', () => {
			const page = new Page(createMockArchive() as never, createRawPage());
			expect(page.responseHeaders).toEqual({ 'content-type': 'text/html' });
		});

		it('returns empty object for invalid responseHeaders JSON', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ responseHeaders: 'not-json' }),
			);
			expect(page.responseHeaders).toEqual({});
		});
	});

	describe('isPage / isInternalPage', () => {
		it('returns true for text/html content type', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ contentType: 'text/html' }),
			);
			expect(page.isPage()).toBe(true);
		});

		it('returns true for text/html with extra whitespace', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ contentType: ' text/html ' }),
			);
			expect(page.isPage()).toBe(true);
		});

		it('returns false for non-html content type', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ contentType: 'application/json' }),
			);
			expect(page.isPage()).toBe(false);
		});

		it('returns false for null content type', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ contentType: null }),
			);
			expect(page.isPage()).toBe(false);
		});

		it('isInternalPage returns true for internal HTML pages', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ contentType: 'text/html', isExternal: 0 }),
			);
			expect(page.isInternalPage()).toBe(true);
		});

		it('isInternalPage returns false for external pages', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ contentType: 'text/html', isExternal: 1 }),
			);
			expect(page.isInternalPage()).toBe(false);
		});
	});

	describe('redirectFrom', () => {
		it('maps rawRedirects to Redirect[]', () => {
			const redirects: DB_Redirect[] = [
				{ pageId: 1, from: 'https://old.com/', fromId: 10 },
			];
			const page = new Page(createMockArchive() as never, createRawPage(), redirects);
			expect(page.redirectFrom).toEqual([{ url: 'https://old.com/', pageId: 10 }]);
		});

		it('returns empty array when no redirects', () => {
			const page = new Page(createMockArchive() as never, createRawPage());
			expect(page.redirectFrom).toEqual([]);
		});
	});

	describe('getAnchors', () => {
		it('returns pre-loaded anchors without querying archive', async () => {
			const rawAnchors: DB_Anchor[] = [
				{
					pageId: 1,
					url: 'https://example.com/about',
					href: '/about',
					isExternal: 0,
					title: null,
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					hash: null,
					textContent: 'About',
				},
			];
			const archive = createMockArchive();
			const page = new Page(archive as never, createRawPage(), [], rawAnchors);
			const anchors = await page.getAnchors();
			expect(anchors).toHaveLength(1);
			expect(anchors[0].url).toBe('https://example.com/about');
			expect(anchors[0].isExternal).toBe(false);
			expect(archive.getAnchorsOnPage).not.toHaveBeenCalled();
		});

		it('queries archive when no pre-loaded anchors', async () => {
			const archive = createMockArchive({
				getAnchorsOnPage: vi.fn().mockResolvedValue([{ url: 'https://example.com/a' }]),
			});
			const page = new Page(archive as never, createRawPage({ id: 5 }));
			const anchors = await page.getAnchors();
			expect(anchors).toHaveLength(1);
			expect(archive.getAnchorsOnPage).toHaveBeenCalledWith(5);
		});
	});

	describe('getReferrers', () => {
		it('returns pre-loaded referrers without querying archive', async () => {
			const rawReferrers: DB_Referrer[] = [
				{
					pageId: 1,
					url: 'https://example.com/home',
					through: 'https://example.com/home',
					throughId: 2,
					hash: null,
					textContent: 'link text',
				},
			];
			const archive = createMockArchive();
			const page = new Page(
				archive as never,
				createRawPage(),
				[],
				undefined,
				rawReferrers,
			);
			const referrers = await page.getReferrers();
			expect(referrers).toHaveLength(1);
			expect(referrers[0].textContent).toBe('link text');
			expect(archive.getReferrersOfPage).not.toHaveBeenCalled();
		});

		it('defaults textContent to empty string for null', async () => {
			const rawReferrers: DB_Referrer[] = [
				{
					pageId: 1,
					url: 'https://example.com/',
					through: 'https://example.com/',
					throughId: 2,
					hash: null,
					textContent: null,
				},
			];
			const page = new Page(
				createMockArchive() as never,
				createRawPage(),
				[],
				undefined,
				rawReferrers,
			);
			const referrers = await page.getReferrers();
			expect(referrers[0].textContent).toBe('');
		});

		it('queries archive when no pre-loaded referrers', async () => {
			const archive = createMockArchive({
				getReferrersOfPage: vi.fn().mockResolvedValue([]),
			});
			const page = new Page(archive as never, createRawPage({ id: 7 }));
			await page.getReferrers();
			expect(archive.getReferrersOfPage).toHaveBeenCalledWith(7);
		});
	});

	describe('getHtml', () => {
		it('delegates to archive with raw html path', async () => {
			const archive = createMockArchive({
				getHtmlOfPage: vi.fn().mockResolvedValue('<html></html>'),
			});
			const page = new Page(archive as never, createRawPage({ html: 'pages/1.html' }));
			const html = await page.getHtml();
			expect(html).toBe('<html></html>');
			expect(archive.getHtmlOfPage).toHaveBeenCalledWith('pages/1.html');
		});
	});

	describe('getRequests', () => {
		it('always queries archive even when pre-loaded referrers exist', async () => {
			const rawReferrers: DB_Referrer[] = [
				{
					pageId: 1,
					url: 'https://example.com/',
					through: 'https://example.com/',
					throughId: 2,
					hash: null,
					textContent: 'text',
				},
			];
			const archive = createMockArchive({
				getReferrersOfPage: vi.fn().mockResolvedValue([]),
			});
			const page = new Page(
				archive as never,
				createRawPage({ id: 3 }),
				[],
				undefined,
				rawReferrers,
			);
			await page.getRequests();
			expect(archive.getReferrersOfPage).toHaveBeenCalledWith(3);
		});
	});
});
