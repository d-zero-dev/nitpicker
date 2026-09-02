import type { PageListItem, PageListStreamRow } from '@nitpicker/query';

import {
	buildRedirectFromUrlsByDestId,
	countPageListRows,
	getOutboundLinkFactsByPageIds,
	streamPageListRows,
} from '@nitpicker/query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { assertNoLazyCells } from '../test-helpers/assert-no-lazy-cells.js';
import { cellValue, cellNote } from '../test-helpers/cell-inspection.js';
import { createMockSheet } from '../test-helpers/create-mock-sheet.js';
import { oneChunk } from '../test-helpers/one-chunk.js';

import { createPageList } from './create-page-list.js';

vi.mock('@nitpicker/query', () => ({
	streamPageListRows: vi.fn(),
	countPageListRows: vi.fn(),
	getOutboundLinkFactsByPageIds: vi.fn(),
	buildRedirectFromUrlsByDestId: vi.fn(),
}));

const NO_ACCESSOR = undefined as never;

const EMPTY_FACTS = {
	internalLinks: 0,
	internalBadLinks: 0,
	externalLinks: 0,
	externalBadLinks: 0,
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
		protocol: 'https:',
		hostname: 'example.com',
		path1: '/page',
		path2: null,
		path3: null,
		path4: null,
		path5: null,
		path6: null,
		path7: null,
		path8: null,
		path9: null,
		path10: null,
		...overrides,
	};
}

/**
 * Builds a {@link PageListStreamRow} for tests: a {@link PageListItem} plus
 * the `pageId` `streamPageListRows` attaches.
 * @param overrides - Fields to override on the default item/pageId.
 */
function makeStreamRow(
	overrides: Partial<PageListItem> & { pageId?: number } = {},
): PageListStreamRow {
	const { pageId = 1, ...itemOverrides } = overrides;
	return { ...makeItem(itemOverrides), pageId };
}

describe('createPageList', () => {
	beforeEach(() => {
		vi.mocked(streamPageListRows).mockReset();
		vi.mocked(countPageListRows).mockReset();
		vi.mocked(getOutboundLinkFactsByPageIds).mockReset();
		vi.mocked(buildRedirectFromUrlsByDestId).mockReset();
		vi.mocked(buildRedirectFromUrlsByDestId).mockResolvedValue(new Map());
		vi.mocked(getOutboundLinkFactsByPageIds).mockResolvedValue(new Map());
	});

	it('returns sheet config with name "Page List" and requiresReadModel', () => {
		const setting = createPageList()([], NO_ACCESSOR);
		expect(setting.name).toBe('Page List');
		expect(setting.requiresReadModel).toBe(true);
	});

	it('returns the documented base headers', () => {
		const setting = createPageList()([], NO_ACCESSOR);
		const headers = setting.createHeaders();
		expect(headers[0]).toBe('Title');
		expect(headers[1]).toBe('Full Title');
		expect(headers[2]).toBe('URL');
		expect(headers).toContain('Internal Referrers');
		expect(headers).toContain('scroll_height_mobile');
	});

	it('appends plugin report headers after the base columns', () => {
		const setting = createPageList()(
			[{ name: 'plugin', pageData: { headers: { custom: 'Custom Column' }, data: {} } }],
			NO_ACCESSOR,
		);
		const headers = setting.createHeaders();
		expect(headers.at(-1)).toBe('Custom Column');
	});

	it('estimates the row count via countPageListRows, with no urls filter by default', async () => {
		vi.mocked(countPageListRows).mockResolvedValue(42);
		const setting = createPageList()([], NO_ACCESSOR);
		await expect(setting.estimateRowCount()).resolves.toBe(42);
		expect(countPageListRows).toHaveBeenCalledWith(NO_ACCESSOR, { urls: undefined });
	});

	it('forwards options.urls to both countPageListRows and streamPageListRows', async () => {
		vi.mocked(countPageListRows).mockResolvedValue(1);
		vi.mocked(streamPageListRows).mockReturnValueOnce(oneChunk([makeStreamRow()]));
		const urls = ['https://example.com/page'];
		const setting = createPageList({ urls })([], NO_ACCESSOR);

		await setting.estimateRowCount();
		expect(countPageListRows).toHaveBeenCalledWith(NO_ACCESSOR, { urls });

		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});
		expect(streamPageListRows).toHaveBeenCalledWith(NO_ACCESSOR, { urls });
	});

	it('streams rows without any lazy thunks (pins the OOM fix)', async () => {
		vi.mocked(streamPageListRows).mockReturnValueOnce(oneChunk([makeStreamRow()]));
		const setting = createPageList()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});
		assertNoLazyCells(mock.rows);
	});

	it('passes through the read-model-precomputed protocol/hostname/path segments unchanged', async () => {
		vi.mocked(streamPageListRows).mockReturnValueOnce(
			oneChunk([
				makeStreamRow({
					url: 'https://example.com/blog/post-1',
					protocol: 'https:',
					hostname: 'example.com',
					path1: '/blog',
					path2: '/post-1',
				}),
			]),
		);
		const setting = createPageList()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});

		const row = mock.rows[0]!;
		expect(cellValue(row[3]!)).toBe('https:');
		expect(cellValue(row[4]!)).toBe('example.com');
		expect(cellValue(row[5]!)).toBe('/blog');
		expect(cellValue(row[6]!)).toBe('/post-1');
	});

	it('uses displayTitle for the Title column and the raw title for Full Title', async () => {
		vi.mocked(streamPageListRows).mockReturnValueOnce(
			oneChunk([makeStreamRow({ title: 'Post 1 | My Blog', displayTitle: 'Post 1' })]),
		);
		const setting = createPageList()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});

		const row = mock.rows[0]!;
		expect(cellValue(row[0]!)).toBe('Post 1');
		expect(cellValue(row[1]!)).toBe('Post 1 | My Blog');
	});

	it('truncates the Title column note when the full title is extremely long', async () => {
		const longTitle = 'a'.repeat(10_000);
		vi.mocked(streamPageListRows).mockReturnValueOnce(
			oneChunk([makeStreamRow({ title: longTitle })]),
		);
		const setting = createPageList()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});

		const row = mock.rows[0]!;
		const note = cellNote(row[0]!)!;
		expect(note.length).toBeLessThan(10_000);
		expect(note).toContain('truncated');
	});

	it('reports internal/external link counts from getOutboundLinkFactsByPageIds, with no note attached', async () => {
		vi.mocked(streamPageListRows).mockReturnValueOnce(
			oneChunk([makeStreamRow({ url: 'https://example.com/source', pageId: 1 })]),
		);
		vi.mocked(getOutboundLinkFactsByPageIds).mockResolvedValue(
			new Map([
				[
					1,
					{
						internalLinks: 3,
						internalBadLinks: 1,
						externalLinks: 2,
						externalBadLinks: 0,
					},
				],
			]),
		);

		const setting = createPageList()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});

		const row = mock.rows[0]!;
		expect(cellValue(row[19]!)).toBe(3); // Internal Links
		expect(cellValue(row[20]!)).toBe(1); // Internal Bad Links
		expect(cellNote(row[20]!)).toBeUndefined();
		expect(cellValue(row[21]!)).toBe(2); // External Links
		expect(cellValue(row[22]!)).toBe(0); // External Bad Links
		expect(cellNote(row[22]!)).toBeUndefined();
	});

	it('falls back to EMPTY_FACTS-shaped zeros when a page has no outbound-link entry', async () => {
		vi.mocked(streamPageListRows).mockReturnValueOnce(oneChunk([makeStreamRow()]));
		const setting = createPageList()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});

		const row = mock.rows[0]!;
		expect(cellValue(row[19]!)).toBe(EMPTY_FACTS.internalLinks);
		expect(cellValue(row[20]!)).toBe(EMPTY_FACTS.internalBadLinks);
	});

	it('shows dirIndexInboundLinkCount when set, falling back to inboundLinkCount otherwise', async () => {
		vi.mocked(streamPageListRows).mockReturnValueOnce(
			oneChunk([
				makeStreamRow({
					url: 'https://example.com/blog/',
					inboundLinkCount: 3,
					dirIndexInboundLinkCount: 10,
				}),
			]),
		);
		const setting = createPageList()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});
		expect(cellValue(mock.rows[0]![23]!)).toBe(10);
	});

	it('shows the redirect-from count and URL note from buildRedirectFromUrlsByDestId', async () => {
		vi.mocked(streamPageListRows).mockReturnValueOnce(
			oneChunk([makeStreamRow({ url: 'https://example.com/target', pageId: 5 })]),
		);
		vi.mocked(buildRedirectFromUrlsByDestId).mockResolvedValue(
			new Map([[5, ['https://example.com/old']]]),
		);

		const setting = createPageList()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});

		const row = mock.rows[0]!;
		expect(cellValue(row[16]!)).toBe(1);
		expect(cellNote(row[16]!)).toBe('https://example.com/old');
	});

	it('uses "N/A" when lang is null', async () => {
		vi.mocked(streamPageListRows).mockReturnValueOnce(
			oneChunk([makeStreamRow({ lang: null })]),
		);
		const setting = createPageList()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});
		expect(cellValue(mock.rows[0]![17]!)).toBe('N/A');
	});

	it('uses -1 fallback when status is null', async () => {
		vi.mocked(streamPageListRows).mockReturnValueOnce(
			oneChunk([makeStreamRow({ status: null })]),
		);
		const setting = createPageList()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});
		expect(cellValue(mock.rows[0]![15]!)).toBe(-1);
	});

	it('adds plugin report data columns from pageData keyed by URL', async () => {
		vi.mocked(streamPageListRows).mockReturnValueOnce(
			oneChunk([makeStreamRow({ url: 'https://example.com/page' })]),
		);
		const setting = createPageList()(
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
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});

		const headers = setting.createHeaders();
		const scoreIndex = headers.indexOf('Score');
		expect(cellValue(mock.rows[0]![scoreIndex]!)).toBe(95);
	});

	it('truncates an extremely long plugin-supplied note', async () => {
		const longNote = 'x'.repeat(10_000);
		vi.mocked(streamPageListRows).mockReturnValueOnce(
			oneChunk([makeStreamRow({ url: 'https://example.com/page' })]),
		);
		const setting = createPageList()(
			[
				{
					name: 'plugin',
					pageData: {
						headers: { score: 'Score' },
						data: { 'https://example.com/page': { score: { value: 95 } } },
						options: { 'https://example.com/page': { score: { note: longNote } } },
					},
				},
			],
			NO_ACCESSOR,
		);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});

		const headers = setting.createHeaders();
		const scoreIndex = headers.indexOf('Score');
		const note = cellNote(mock.rows[0]![scoreIndex]!)!;
		expect(note.length).toBeLessThan(10_000);
		expect(note).toContain('truncated');
	});

	it('skips a page across cursor pages once maxRows is reached', async () => {
		vi.mocked(streamPageListRows).mockReturnValueOnce(
			oneChunk([
				makeStreamRow({ url: 'https://example.com/a', pageId: 1 }),
				makeStreamRow({ url: 'https://example.com/b', pageId: 2 }),
			]),
		);
		const setting = createPageList()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: 1,
			estimatedTotal: 2,
			onProgress: () => {},
		});
		expect(mock.rows).toHaveLength(1);
		expect(mock.flushCount).toBe(1);
	});

	it('calls frozen, conditionalFormat, and hideCol in updateSheet', async () => {
		const setting = createPageList()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await mock.sheet.setHeaders(setting.createHeaders());
		await setting.updateSheet!(mock.sheet);
		expect(mock.conditionalFormatCalls.length).toBeGreaterThan(0);
	});
});
