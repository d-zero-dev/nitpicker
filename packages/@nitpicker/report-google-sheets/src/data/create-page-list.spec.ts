import type { PageListItem } from '@nitpicker/query';

import {
	buildRedirectFromUrlsByDestId,
	getOutboundLinkFactsByPageIds,
	listViewerPages,
	resolvePageIdsByUrls,
} from '@nitpicker/query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { assertNoLazyCells } from '../test-helpers/assert-no-lazy-cells.js';
import { cellValue, cellNote } from '../test-helpers/cell-inspection.js';
import { createMockSheet } from '../test-helpers/create-mock-sheet.js';

import { createPageList } from './create-page-list.js';

vi.mock('@nitpicker/query', () => ({
	listViewerPages: vi.fn(),
	getOutboundLinkFactsByPageIds: vi.fn(),
	buildRedirectFromUrlsByDestId: vi.fn(),
	resolvePageIdsByUrls: vi.fn(),
}));

const NO_ACCESSOR = undefined as never;

const EMPTY_FACTS = {
	internalLinks: 0,
	internalBadLinks: 0,
	internalBadLinkNote: '',
	externalLinks: 0,
	externalBadLinks: 0,
	externalBadLinkNote: '',
};

/**
 * Builds a fully-populated {@link PageListItem} for tests, with sensible
 * defaults overridable per field.
 * @param overrides - Fields to override on the default item.
 */
function makeItem(overrides: Partial<PageListItem> = {}): PageListItem {
	return {
		url: 'https://example.com/page',
		title: 'Page',
		status: 200,
		contentType: 'text/html',
		isExternal: false,
		hasDescription: false,
		hasOgTitle: false,
		noindex: false,
		description: null,
		keywords: null,
		lang: 'en',
		nofollow: false,
		noarchive: false,
		robotsRaw: null,
		canonical: null,
		ogType: null,
		ogTitle: null,
		ogSiteName: null,
		ogDescription: null,
		ogUrl: null,
		ogImage: null,
		ogImageAlt: null,
		ogLocale: null,
		ogArticlePublishedTime: null,
		twitterCard: null,
		twitterSite: null,
		twitterCreator: null,
		twitterImage: null,
		charset: 'utf8',
		themeColor: null,
		manifest: null,
		tagCount: null,
		jsonldCount: 0,
		tagsProvidersCsv: null,
		mainContentNodeName: null,
		mainContentId: null,
		mainContentRole: null,
		mainContentSelector: null,
		mainContentClassList: null,
		mainContentWordCount: null,
		mainContentBodyWordCount: null,
		mainContentHeadingCount: null,
		mainContentImageCount: null,
		mainContentTableCount: null,
		mainContentButtonCount: null,
		mainContentIframeCount: null,
		mainContentVideoCount: null,
		mainContentAudioCount: null,
		mainContentCanvasCount: null,
		mainContentCustomElementCount: null,
		scrollHeightDesktop: null,
		scrollHeightMobile: null,
		consoleErrorCount: null,
		firstCrawledAt: null,
		lastCrawledAt: null,
		hasCSP: false,
		hasXFrameOptions: false,
		hasXContentTypeOptions: false,
		hasHSTS: false,
		templateKey: null,
		isDedupeCapped: false,
		displayTitle: overrides.title === undefined ? 'Page' : overrides.title,
		inboundLinkCount: 0,
		dirIndexInboundLinkCount: null,
		...overrides,
	};
}

/**
 * Builds a one-page `listViewerPages` result.
 * @param items - The page items for this result.
 * @param nextCursor - The `nextCursor` value, `null` by default.
 */
function makePage(items: PageListItem[], nextCursor: string | null = null) {
	return {
		items,
		total: items.length,
		facets: { statuses: [], contentTypes: [], languages: [] } as never,
		offset: 0,
		limit: 500,
		nextCursor,
		prevCursor: null,
	};
}

describe('createPageList', () => {
	beforeEach(() => {
		vi.mocked(listViewerPages).mockReset();
		vi.mocked(getOutboundLinkFactsByPageIds).mockReset();
		vi.mocked(buildRedirectFromUrlsByDestId).mockReset();
		vi.mocked(resolvePageIdsByUrls).mockReset();
		vi.mocked(buildRedirectFromUrlsByDestId).mockResolvedValue(new Map());
		vi.mocked(resolvePageIdsByUrls).mockResolvedValue(new Map());
		vi.mocked(getOutboundLinkFactsByPageIds).mockResolvedValue(new Map());
	});

	it('returns sheet config with name "Page List" and requiresReadModel', () => {
		const setting = createPageList([], NO_ACCESSOR);
		expect(setting.name).toBe('Page List');
		expect(setting.requiresReadModel).toBe(true);
	});

	it('returns the documented base headers', () => {
		const setting = createPageList([], NO_ACCESSOR);
		const headers = setting.createHeaders();
		expect(headers[0]).toBe('Title');
		expect(headers[1]).toBe('Full Title');
		expect(headers[2]).toBe('URL');
		expect(headers).toContain('Internal Referrers');
		expect(headers).toContain('scroll_height_mobile');
	});

	it('appends plugin report headers after the base columns', () => {
		const setting = createPageList(
			[{ name: 'plugin', pageData: { headers: { custom: 'Custom Column' }, data: {} } }],
			NO_ACCESSOR,
		);
		const headers = setting.createHeaders();
		expect(headers.at(-1)).toBe('Custom Column');
	});

	it('estimates the row count via listViewerPages(isExternal: false, limit: 0)', async () => {
		vi.mocked(listViewerPages).mockResolvedValue(makePage([], null));
		const setting = createPageList([], NO_ACCESSOR);
		await setting.estimateRowCount();
		expect(listViewerPages).toHaveBeenCalledWith(NO_ACCESSOR, {
			isExternal: false,
			limit: 0,
		});
	});

	it('streams rows without any lazy thunks (pins the OOM fix)', async () => {
		vi.mocked(listViewerPages).mockResolvedValueOnce(makePage([makeItem()]));
		const setting = createPageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });
		assertNoLazyCells(mock.rows);
	});

	it('decomposes the URL into protocol, hostname, and path segments', async () => {
		vi.mocked(listViewerPages).mockResolvedValueOnce(
			makePage([makeItem({ url: 'https://example.com/blog/post-1' })]),
		);
		const setting = createPageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });

		const row = mock.rows[0]!;
		expect(cellValue(row[3]!)).toBe('https:');
		expect(cellValue(row[4]!)).toBe('example.com');
		expect(cellValue(row[5]!)).toBe('/blog');
		expect(cellValue(row[6]!)).toBe('/post-1');
	});

	it('uses displayTitle for the Title column and the raw title for Full Title', async () => {
		vi.mocked(listViewerPages).mockResolvedValueOnce(
			makePage([makeItem({ title: 'Post 1 | My Blog', displayTitle: 'Post 1' })]),
		);
		const setting = createPageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });

		const row = mock.rows[0]!;
		expect(cellValue(row[0]!)).toBe('Post 1');
		expect(cellValue(row[1]!)).toBe('Post 1 | My Blog');
	});

	it('reports internal/external link counts and bad-link notes from getOutboundLinkFactsByPageIds', async () => {
		vi.mocked(listViewerPages).mockResolvedValueOnce(
			makePage([makeItem({ url: 'https://example.com/source' })]),
		);
		vi.mocked(resolvePageIdsByUrls).mockResolvedValue(
			new Map([['https://example.com/source', 1]]),
		);
		vi.mocked(getOutboundLinkFactsByPageIds).mockResolvedValue(
			new Map([
				[
					1,
					{
						internalLinks: 3,
						internalBadLinks: 1,
						internalBadLinkNote: 'bad note',
						externalLinks: 2,
						externalBadLinks: 0,
						externalBadLinkNote: '',
					},
				],
			]),
		);

		const setting = createPageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });

		const row = mock.rows[0]!;
		expect(cellValue(row[19]!)).toBe(3); // Internal Links
		expect(cellValue(row[20]!)).toBe(1); // Internal Bad Links
		expect(cellNote(row[20]!)).toBe('bad note');
		expect(cellValue(row[21]!)).toBe(2); // External Links
		expect(cellValue(row[22]!)).toBe(0); // External Bad Links
	});

	it('falls back to EMPTY_FACTS-shaped zeros when a page has no outbound-link entry', async () => {
		vi.mocked(listViewerPages).mockResolvedValueOnce(makePage([makeItem()]));
		const setting = createPageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });

		const row = mock.rows[0]!;
		expect(cellValue(row[19]!)).toBe(EMPTY_FACTS.internalLinks);
		expect(cellValue(row[20]!)).toBe(EMPTY_FACTS.internalBadLinks);
	});

	it('shows dirIndexInboundLinkCount when set, falling back to inboundLinkCount otherwise', async () => {
		vi.mocked(listViewerPages).mockResolvedValueOnce(
			makePage([
				makeItem({
					url: 'https://example.com/blog/',
					inboundLinkCount: 3,
					dirIndexInboundLinkCount: 10,
				}),
			]),
		);
		const setting = createPageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });
		expect(cellValue(mock.rows[0]![23]!)).toBe(10);
	});

	it('shows the redirect-from count and URL note from buildRedirectFromUrlsByDestId', async () => {
		vi.mocked(listViewerPages).mockResolvedValueOnce(
			makePage([makeItem({ url: 'https://example.com/target' })]),
		);
		vi.mocked(resolvePageIdsByUrls).mockResolvedValue(
			new Map([['https://example.com/target', 5]]),
		);
		vi.mocked(buildRedirectFromUrlsByDestId).mockResolvedValue(
			new Map([[5, ['https://example.com/old']]]),
		);

		const setting = createPageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });

		const row = mock.rows[0]!;
		expect(cellValue(row[16]!)).toBe(1);
		expect(cellNote(row[16]!)).toBe('https://example.com/old');
	});

	it('uses "N/A" when lang is null', async () => {
		vi.mocked(listViewerPages).mockResolvedValueOnce(
			makePage([makeItem({ lang: null })]),
		);
		const setting = createPageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });
		expect(cellValue(mock.rows[0]![17]!)).toBe('N/A');
	});

	it('uses -1 fallback when status is null', async () => {
		vi.mocked(listViewerPages).mockResolvedValueOnce(
			makePage([makeItem({ status: null })]),
		);
		const setting = createPageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });
		expect(cellValue(mock.rows[0]![15]!)).toBe(-1);
	});

	it('adds plugin report data columns from pageData keyed by URL', async () => {
		vi.mocked(listViewerPages).mockResolvedValueOnce(
			makePage([makeItem({ url: 'https://example.com/page' })]),
		);
		const setting = createPageList(
			[
				{
					name: 'plugin',
					pageData: {
						headers: { score: 'Score' },
						data: { 'https://example.com/page': { score: { value: 95 } } },
					},
				},
			],
			NO_ACCESSOR,
		);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });

		const headers = setting.createHeaders();
		const scoreIndex = headers.indexOf('Score');
		expect(cellValue(mock.rows[0]![scoreIndex]!)).toBe(95);
	});

	it('skips a page across cursor pages once maxRows is reached', async () => {
		vi.mocked(listViewerPages).mockResolvedValueOnce(
			makePage([
				makeItem({ url: 'https://example.com/a' }),
				makeItem({ url: 'https://example.com/b' }),
			]),
		);
		const setting = createPageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: 1, onProgress: () => {} });
		expect(mock.rows).toHaveLength(1);
		expect(mock.flushCount).toBe(1);
	});

	it('calls frozen, conditionalFormat, and hideCol in updateSheet', async () => {
		const setting = createPageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await mock.sheet.setHeaders(setting.createHeaders());
		await setting.updateSheet!(mock.sheet);
		expect(mock.conditionalFormatCalls.length).toBeGreaterThan(0);
	});
});
