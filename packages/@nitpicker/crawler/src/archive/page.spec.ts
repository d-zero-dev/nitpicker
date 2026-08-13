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
		getAudiosOfPage: vi.fn().mockResolvedValue([]),
		getButtonsOfPage: vi.fn().mockResolvedValue([]),
		getCanvasesOfPage: vi.fn().mockResolvedValue([]),
		getHeadingsOfPage: vi.fn().mockResolvedValue([]),
		getIframesOfPage: vi.fn().mockResolvedValue([]),
		getMainContentImagesOfPage: vi.fn().mockResolvedValue([]),
		getMainContentTablesOfPage: vi.fn().mockResolvedValue([]),
		getVideosOfPage: vi.fn().mockResolvedValue([]),
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
		dir: null,
		// eslint-disable-next-line unicorn/text-encoding-identifier-case -- HTML5 attribute value is canonically 'utf-8'.
		charset: 'utf-8',
		baseHref: null,
		viewport_raw: null,
		themeColor: null,
		applicationName: null,
		author: null,
		generator: null,
		publisher: null,
		title: 'Example Page',
		description: 'A test page',
		keywords: 'test,example',
		robots_raw: null,
		robots_noindex: 0,
		robots_nofollow: 0,
		robots_noarchive: 0,
		robots_noimageindex: 0,
		googlebot: null,
		canonical: 'https://example.com/',
		amphtml: null,
		manifest: null,
		icon_href: null,
		appleTouchIcon_href: null,
		og_type: 'website',
		og_title: 'Example',
		og_site_name: 'Example Site',
		og_description: 'OG description',
		og_url: 'https://example.com/',
		og_image: 'https://example.com/image.png',
		og_image_alt: null,
		og_image_width: null,
		og_image_height: null,
		og_locale: null,
		og_article_published_time: null,
		og_article_modified_time: null,
		twitter_card: 'summary',
		twitter_site: null,
		twitter_creator: null,
		twitter_title: null,
		twitter_description: null,
		twitter_image: null,
		fb_app_id: null,
		verification_google: null,
		formatDetection_telephone: null,
		firstCrawledAt: null,
		lastCrawledAt: null,
		tag_count: null,
		jsonld_count: null,
		tags_providers_csv: null,
		main_content_node_name: null,
		main_content_id: null,
		main_content_role: null,
		main_content_selector: null,
		main_content_class_list: null,
		main_content_word_count: null,
		main_content_body_word_count: null,
		main_content_heading_count: null,
		main_content_image_count: null,
		main_content_table_count: null,
		main_content_button_count: null,
		main_content_iframe_count: null,
		main_content_video_count: null,
		main_content_audio_count: null,
		main_content_canvas_count: null,
		main_content_custom_element_count: null,
		scroll_height_desktop: null,
		scroll_height_mobile: null,
		meta_extras: null,
		networkLogs: null,
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

		it('returns robots_noindex/nofollow/noarchive as booleans', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({
					robots_noindex: 1,
					robots_nofollow: 1,
					robots_noarchive: 1,
				}),
			);
			expect(page.robots_noindex).toBe(true);
			expect(page.robots_nofollow).toBe(true);
			expect(page.robots_noarchive).toBe(true);
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

		it('returns main-content identity fields from raw data', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({
					main_content_node_name: 'MAIN',
					main_content_id: 'content',
					main_content_role: 'main',
					main_content_selector: 'main#content',
				}),
			);
			expect(page.mainContentNodeName).toBe('MAIN');
			expect(page.mainContentId).toBe('content');
			expect(page.mainContentRole).toBe('main');
			expect(page.mainContentSelector).toBe('main#content');
		});

		it('returns null main-content identity fields when no main region was found', () => {
			const page = new Page(createMockArchive() as never, createRawPage());
			expect(page.mainContentNodeName).toBeNull();
			expect(page.mainContentId).toBeNull();
			expect(page.mainContentRole).toBeNull();
			expect(page.mainContentSelector).toBeNull();
		});

		it('parses mainContentClassList from JSON string', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ main_content_class_list: '["l-main","p-home"]' }),
			);
			expect(page.mainContentClassList).toEqual(['l-main', 'p-home']);
		});

		it('returns null mainContentClassList when column is null', () => {
			const page = new Page(createMockArchive() as never, createRawPage());
			expect(page.mainContentClassList).toBeNull();
		});

		it('returns main-content aggregate counts from raw data', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({
					main_content_word_count: 100,
					main_content_body_word_count: 150,
					main_content_heading_count: 3,
					main_content_image_count: 2,
					main_content_table_count: 1,
					main_content_button_count: 4,
					main_content_iframe_count: 1,
					main_content_video_count: 1,
					main_content_audio_count: 1,
					main_content_canvas_count: 1,
					main_content_custom_element_count: 2,
				}),
			);
			expect(page.mainContentWordCount).toBe(100);
			expect(page.mainContentBodyWordCount).toBe(150);
			expect(page.mainContentHeadingCount).toBe(3);
			expect(page.mainContentImageCount).toBe(2);
			expect(page.mainContentTableCount).toBe(1);
			expect(page.mainContentButtonCount).toBe(4);
			expect(page.mainContentIframeCount).toBe(1);
			expect(page.mainContentVideoCount).toBe(1);
			expect(page.mainContentAudioCount).toBe(1);
			expect(page.mainContentCanvasCount).toBe(1);
			expect(page.mainContentCustomElementCount).toBe(2);
		});

		it('returns null main-content aggregate counts for an unrendered page', () => {
			const page = new Page(createMockArchive() as never, createRawPage());
			expect(page.mainContentWordCount).toBeNull();
			expect(page.mainContentBodyWordCount).toBeNull();
			expect(page.mainContentHeadingCount).toBeNull();
			expect(page.mainContentImageCount).toBeNull();
			expect(page.mainContentTableCount).toBeNull();
			expect(page.mainContentButtonCount).toBeNull();
			expect(page.mainContentIframeCount).toBeNull();
			expect(page.mainContentVideoCount).toBeNull();
			expect(page.mainContentAudioCount).toBeNull();
			expect(page.mainContentCanvasCount).toBeNull();
			expect(page.mainContentCustomElementCount).toBeNull();
		});

		it('returns scrollHeightDesktop/Mobile from raw data', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ scroll_height_desktop: 3200, scroll_height_mobile: 5400 }),
			);
			expect(page.scrollHeightDesktop).toBe(3200);
			expect(page.scrollHeightMobile).toBe(5400);
		});

		it('includes main-content columns in metaFlat', () => {
			const page = new Page(
				createMockArchive() as never,
				createRawPage({ main_content_word_count: 100 }),
			);
			expect(page.metaFlat.main_content_word_count).toBe(100);
			expect(page.metaFlat.scroll_height_desktop).toBeNull();
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

		it('多値ヘッダー（set-cookie 等）の string[] 値はそのまま保持される', () => {
			// 型が Record<string, string | string[] | undefined> であることの実体保証:
			// 配列値が文字列化されたり欠落したりしない
			const page = new Page(
				createMockArchive() as never,
				createRawPage({
					responseHeaders: '{"set-cookie":["a=1; Path=/","b=2; Path=/"]}',
				}),
			);
			expect(page.responseHeaders).toEqual({
				'set-cookie': ['a=1; Path=/', 'b=2; Path=/'],
			});
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
				{ pageId: 1, from: 'https://old.example.com/', fromId: 10 },
			];
			const page = new Page(createMockArchive() as never, createRawPage(), redirects);
			expect(page.redirectFrom).toEqual([
				{ url: 'https://old.example.com/', pageId: 10 },
			]);
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

		it('プリロード無しのフォールバックでも through/throughId を含む Referrer 形状にマップする', async () => {
			// getReferrersOfPage は redirect 解決済みの行（through = アンカーが実際に
			// 指した URL）を返す。フォールバック経路でも #rawReferrers 経路と同じ形状に
			// マップされ、report の "[REDIRECTED FROM]" 判定が機能することを保証する。
			const archive = createMockArchive({
				getReferrersOfPage: vi.fn().mockResolvedValue([
					{
						url: 'https://example.com/linker',
						through: 'http://example.com/page',
						throughId: 9,
						hash: null,
						textContent: null,
					},
				]),
			});
			const page = new Page(archive as never, createRawPage({ id: 7 }));
			const referrers = await page.getReferrers();
			expect(referrers).toEqual([
				{
					url: 'https://example.com/linker',
					through: 'http://example.com/page',
					throughId: 9,
					hash: null,
					textContent: '',
				},
			]);
		});
	});

	describe('getHtml', () => {
		it('delegates to archive with page id (BLOB lookup)', async () => {
			const archive = createMockArchive({
				getHtmlOfPage: vi.fn().mockResolvedValue('<html></html>'),
			});
			const page = new Page(archive as never, createRawPage({ id: 42 }));
			const html = await page.getHtml();
			expect(html).toBe('<html></html>');
			expect(archive.getHtmlOfPage).toHaveBeenCalledWith(42);
		});
	});

	describe('main-content child-table getters', () => {
		it('getHeadings delegates to archive with page id', async () => {
			const headings = [{ id: 1, pageId: 42, order: 0, text: 'Title', level: 1 }];
			const archive = createMockArchive({
				getHeadingsOfPage: vi.fn().mockResolvedValue(headings),
			});
			const page = new Page(archive as never, createRawPage({ id: 42 }));
			await expect(page.getHeadings()).resolves.toBe(headings);
			expect(archive.getHeadingsOfPage).toHaveBeenCalledWith(42);
		});

		it('getMainContentImages delegates to archive with page id', async () => {
			const images = [{ id: 1, pageId: 42, order: 0, src: 'a.png', alt: 'A' }];
			const archive = createMockArchive({
				getMainContentImagesOfPage: vi.fn().mockResolvedValue(images),
			});
			const page = new Page(archive as never, createRawPage({ id: 42 }));
			await expect(page.getMainContentImages()).resolves.toBe(images);
			expect(archive.getMainContentImagesOfPage).toHaveBeenCalledWith(42);
		});

		it('getMainContentTables delegates to archive with page id', async () => {
			const tables = [
				{
					id: 1,
					pageId: 42,
					order: 0,
					rows: 2,
					cols: 3,
					hasHeader: 1,
					hasFooter: 0,
					hasMergedCell: 0,
				},
			];
			const archive = createMockArchive({
				getMainContentTablesOfPage: vi.fn().mockResolvedValue(tables),
			});
			const page = new Page(archive as never, createRawPage({ id: 42 }));
			await expect(page.getMainContentTables()).resolves.toBe(tables);
			expect(archive.getMainContentTablesOfPage).toHaveBeenCalledWith(42);
		});

		it('getButtons delegates to archive with page id', async () => {
			const buttons = [
				{
					id: 1,
					pageId: 42,
					order: 0,
					nodeName: 'BUTTON',
					role: null,
					type: 'submit',
					text: 'Send',
					disabled: 0,
				},
			];
			const archive = createMockArchive({
				getButtonsOfPage: vi.fn().mockResolvedValue(buttons),
			});
			const page = new Page(archive as never, createRawPage({ id: 42 }));
			await expect(page.getButtons()).resolves.toBe(buttons);
			expect(archive.getButtonsOfPage).toHaveBeenCalledWith(42);
		});

		it('getIframes delegates to archive with page id', async () => {
			const iframes = [
				{
					id: 1,
					pageId: 42,
					order: 0,
					src: 'a.html',
					title: null,
					width: null,
					height: null,
				},
			];
			const archive = createMockArchive({
				getIframesOfPage: vi.fn().mockResolvedValue(iframes),
			});
			const page = new Page(archive as never, createRawPage({ id: 42 }));
			await expect(page.getIframes()).resolves.toBe(iframes);
			expect(archive.getIframesOfPage).toHaveBeenCalledWith(42);
		});

		it('getVideos delegates to archive with page id', async () => {
			const videos = [
				{
					id: 1,
					pageId: 42,
					order: 0,
					src: 'a.mp4',
					poster: null,
					width: 640,
					height: 360,
				},
			];
			const archive = createMockArchive({
				getVideosOfPage: vi.fn().mockResolvedValue(videos),
			});
			const page = new Page(archive as never, createRawPage({ id: 42 }));
			await expect(page.getVideos()).resolves.toBe(videos);
			expect(archive.getVideosOfPage).toHaveBeenCalledWith(42);
		});

		it('getAudios delegates to archive with page id', async () => {
			const audios = [{ id: 1, pageId: 42, order: 0, src: 'a.mp3' }];
			const archive = createMockArchive({
				getAudiosOfPage: vi.fn().mockResolvedValue(audios),
			});
			const page = new Page(archive as never, createRawPage({ id: 42 }));
			await expect(page.getAudios()).resolves.toBe(audios);
			expect(archive.getAudiosOfPage).toHaveBeenCalledWith(42);
		});

		it('getCanvases delegates to archive with page id', async () => {
			const canvases = [{ id: 1, pageId: 42, order: 0, width: 300, height: 150 }];
			const archive = createMockArchive({
				getCanvasesOfPage: vi.fn().mockResolvedValue(canvases),
			});
			const page = new Page(archive as never, createRawPage({ id: 42 }));
			await expect(page.getCanvases()).resolves.toBe(canvases);
			expect(archive.getCanvasesOfPage).toHaveBeenCalledWith(42);
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

		it('through/throughId を含む Referrer 形状にマップする', async () => {
			const archive = createMockArchive({
				getReferrersOfPage: vi.fn().mockResolvedValue([
					{
						url: 'https://example.com/linker',
						through: 'http://example.com/page',
						throughId: 9,
						hash: 'sec',
						textContent: 'text',
					},
				]),
			});
			const page = new Page(archive as never, createRawPage({ id: 3 }));
			const requests = await page.getRequests();
			expect(requests).toEqual([
				{
					url: 'https://example.com/linker',
					through: 'http://example.com/page',
					throughId: 9,
					hash: 'sec',
					textContent: 'text',
				},
			]);
		});
	});
});
