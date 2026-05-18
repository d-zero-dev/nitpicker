import type { Sheet } from '@d-zero/google-sheets';
import type { Page } from '@nitpicker/crawler';
import type { Report } from '@nitpicker/types';

import { Cell } from '@d-zero/google-sheets';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

/**
 * Creates a mock Page object with sensible defaults for testing.
 * @param overrides - Properties to override on the default mock page.
 * @returns A mock Page instance cast via `as never`.
 */
function createMockPage(overrides: Partial<Record<string, unknown>> = {}): Page {
	return {
		url: {
			href: 'https://example.com/',
			protocol: 'https:',
			hostname: 'example.com',
			paths: [''],
			depth: 0,
			dirname: null,
			basename: '',
			isIndex: true,
			query: '',
		},
		title: 'Example Page',
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 1000,
		lang: 'ja',
		isExternal: false,
		isTarget: true,
		isSkipped: false,
		skipReason: null,
		redirectFrom: [],
		responseHeaders: {},
		description: null,
		keywords: null,
		noindex: false,
		nofollow: false,
		noarchive: false,
		canonical: null,
		alternate: null,
		twitter_card: null,
		og_site_name: null,
		og_url: null,
		og_title: null,
		og_description: null,
		og_type: null,
		og_image: null,
		isInternalPage: () => true,
		isPage: () => true,
		getAnchors: vi.fn().mockResolvedValue([]),
		getReferrers: vi.fn().mockResolvedValue([]),
		getHtml: vi.fn().mockResolvedValue(null),
		...overrides,
	} as never;
}

/**
 * Extracts the primitive value from a Cell by calling `provide()` and reading `userEnteredValue`.
 * @param cell - A Cell object with a `provide` method.
 * @param cell.provide
 * @returns The string, number, boolean, or formula value held by the cell.
 */
function cellValue(cell: {
	provide: (n?: number) => { userEnteredValue: Record<string, unknown> };
}) {
	const provided = cell.provide();
	return (
		provided.userEnteredValue.stringValue ??
		provided.userEnteredValue.numberValue ??
		provided.userEnteredValue.boolValue ??
		provided.userEnteredValue.formulaValue ??
		''
	);
}

/**
 * Extracts the note string from a Cell by calling `provide()`.
 * @param cell - A Cell object with a `provide` method.
 * @param cell.provide
 * @returns The note attached to the cell, or `undefined`.
 */
function cellNote(cell: { provide: (n?: number) => { note?: string } }) {
	return cell.provide().note;
}

describe('createPageList', () => {
	// Reset modules before each test to clear module-scope state (indexTitles, indexRefs)
	let createPageList: import('../sheets/types.js').CreateSheet;

	beforeEach(async () => {
		vi.resetModules();
		const mod = await import('./create-page-list.js');
		createPageList = mod.createPageList;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns sheet config with name "Page List"', () => {
		const sheet = createPageList([]);
		expect(sheet.name).toBe('Page List');
	});

	it('opts into bufferRows because the "Internal Referrers" cell is a lazy thunk', () => {
		// The lazy thunk at create-page-list.ts:238-256 reads parentRefs/refers
		// at provide() time. Sibling index pages mutate that shared state as the
		// batch iterates, so the row must be held until the batch completes.
		// Streaming mid-iteration would evaluate the thunk before later pages
		// had updated the refs, corrupting the "Internal Referrers" count.
		const sheet = createPageList([]);
		expect(sheet.bufferRows).toBe(true);
	});

	it('emits at least one lazy cell from eachPage, justifying bufferRows: true', async () => {
		// The inverse of the eager-cell check in the streaming sheet specs:
		// PageList legitimately needs bufferRows because at least one of its
		// cells is a LazyCell (provide() is overridden, so it does not match
		// Cell.prototype.provide). If a future refactor eliminates all lazy
		// cells here, bufferRows can be flipped to false for the memory win.
		const sheet = createPageList([]);
		const rows = await sheet.eachPage!(createMockPage(), 1, 1, null);
		expect(rows).toBeTruthy();
		const allCells = rows!.flat();
		const hasLazyCell = allCells.some((cell) => cell.provide !== Cell.prototype.provide);
		expect(hasLazyCell).toBe(true);
	});

	it('returns correct base headers (37 columns)', () => {
		const sheet = createPageList([]);
		const headers = sheet.createHeaders();
		expect(headers).toHaveLength(37);
		expect(headers[0]).toBe('Title');
		expect(headers[1]).toBe('Full Title');
		expect(headers[2]).toBe('URL');
		expect(headers[3]).toBe('Protocol');
		expect(headers[4]).toBe('Domain');
		expect(headers.slice(5, 15)).toEqual([
			'path1',
			'path2',
			'path3',
			'path4',
			'path5',
			'path6',
			'path7',
			'path8',
			'path9',
			'path10',
		]);
		expect(headers[15]).toBe('Status Code');
		expect(headers[16]).toBe('Redirect From');
		expect(headers[17]).toBe('Language');
		expect(headers[18]).toBe('Internal Links');
		expect(headers[19]).toBe('Internal Bad Links');
		expect(headers[20]).toBe('External Links');
		expect(headers[21]).toBe('External Bad Links');
		expect(headers[22]).toBe('Internal Referrers');
		expect(headers[36]).toBe('og:image');
	});

	it('appends plugin report headers', () => {
		const reports: Report[] = [
			{
				name: 'plugin-a',
				pageData: {
					headers: { col1: 'Plugin A Col 1', col2: 'Plugin A Col 2' },
					data: {},
				},
			},
		];

		const sheet = createPageList(reports);
		const headers = sheet.createHeaders();

		expect(headers).toHaveLength(39);
		expect(headers[37]).toBe('Plugin A Col 1');
		expect(headers[38]).toBe('Plugin A Col 2');
	});

	it('skips external pages', async () => {
		const page = createMockPage({ isInternalPage: () => false });
		const sheet = createPageList([]);
		const result = await sheet.eachPage!(page, 1, 1, null);

		expect(result).toBeUndefined();
	});

	it('skips non-target pages', async () => {
		const page = createMockPage({ isTarget: false });
		const sheet = createPageList([]);
		const result = await sheet.eachPage!(page, 1, 1, null);

		expect(result).toBeUndefined();
	});

	it('decomposes URL into protocol, hostname, and path segments', async () => {
		const page = createMockPage({
			url: {
				href: 'https://example.com/about/team/',
				protocol: 'https:',
				hostname: 'example.com',
				paths: ['about', 'team', ''],
				depth: 3,
				dirname: '/about/team',
				basename: '',
				isIndex: true,
				query: '',
			},
		});

		const sheet = createPageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(rows).toHaveLength(1);
		const row = rows![0];

		// Protocol
		expect(cellValue(row[3])).toBe('https:');
		// Domain
		expect(cellValue(row[4])).toBe('example.com');
		// path1
		expect(cellValue(row[5])).toBe('/about');
		// path2
		expect(cellValue(row[6])).toBe('/team');
		// path3 (last segment with empty basename)
		expect(cellValue(row[7])).toBe('/');
	});

	it('appends query string to last path segment', async () => {
		const page = createMockPage({
			url: {
				href: 'https://example.com/search?q=test',
				protocol: 'https:',
				hostname: 'example.com',
				paths: ['search'],
				depth: 1,
				dirname: '/',
				basename: 'search',
				isIndex: false,
				query: 'q=test',
			},
		});

		const sheet = createPageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		// Last path should include query
		expect(cellValue(rows![0][5])).toBe('/search?q=test');
	});

	it('counts internal and external links', async () => {
		const page = createMockPage({
			getAnchors: vi.fn().mockResolvedValue([
				{
					isExternal: false,
					status: 200,
					statusText: 'OK',
					textContent: 'a',
					href: 'h',
					url: 'h',
				},
				{
					isExternal: false,
					status: 200,
					statusText: 'OK',
					textContent: 'b',
					href: 'h',
					url: 'h',
				},
				{
					isExternal: true,
					status: 200,
					statusText: 'OK',
					textContent: 'c',
					href: 'h',
					url: 'h',
				},
			]),
		});

		const sheet = createPageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		// Internal Links
		expect(cellValue(rows![0][18])).toBe(2);
		// External Links
		expect(cellValue(rows![0][20])).toBe(1);
	});

	it('identifies bad links with status >= 400 (excluding 401)', async () => {
		const page = createMockPage({
			getAnchors: vi.fn().mockResolvedValue([
				{
					isExternal: false,
					status: 404,
					statusText: 'Not Found',
					textContent: 'broken',
					href: '/broken',
					url: '/broken',
				},
				{
					isExternal: false,
					status: 401,
					statusText: 'Unauthorized',
					textContent: 'auth',
					href: '/auth',
					url: '/auth',
				},
				{
					isExternal: true,
					status: 500,
					statusText: 'Server Error',
					textContent: 'err',
					href: 'http://ext.com',
					url: 'http://ext.com',
				},
				{
					isExternal: true,
					status: 200,
					statusText: 'OK',
					textContent: 'ok',
					href: 'http://ext.com/ok',
					url: 'http://ext.com/ok',
				},
			]),
		});

		const sheet = createPageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		// Internal Bad Links (404 counted, 401 excluded)
		expect(cellValue(rows![0][19])).toBe(1);
		// External Bad Links (500 counted)
		expect(cellValue(rows![0][21])).toBe(1);
	});

	it('counts null/0 status as bad link', async () => {
		const page = createMockPage({
			getAnchors: vi.fn().mockResolvedValue([
				{
					isExternal: false,
					status: null,
					statusText: '',
					textContent: 'no-status',
					href: '/x',
					url: '/x',
				},
				{
					isExternal: false,
					status: 0,
					statusText: '',
					textContent: 'zero',
					href: '/y',
					url: '/y',
				},
			]),
		});

		const sheet = createPageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		// Both null and 0 status should be counted as bad
		expect(cellValue(rows![0][19])).toBe(2);
	});

	it('includes bad link details in note', async () => {
		const page = createMockPage({
			getAnchors: vi.fn().mockResolvedValue([
				{
					isExternal: false,
					status: 404,
					statusText: 'Not Found',
					textContent: 'broken link',
					href: '/broken',
					url: '/broken',
				},
			]),
		});

		const sheet = createPageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellNote(rows![0][19])).toContain('broken link');
		expect(cellNote(rows![0][19])).toContain('404');
	});

	it('shows redirect URL when href differs from url', async () => {
		const page = createMockPage({
			getAnchors: vi.fn().mockResolvedValue([
				{
					isExternal: false,
					status: 404,
					statusText: 'Not Found',
					textContent: 'link',
					href: '/old',
					url: '/new',
				},
			]),
		});

		const sheet = createPageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellNote(rows![0][19])).toContain('/old => /new');
	});

	it('uses "N/A" when lang is null', async () => {
		const page = createMockPage({ lang: null });
		const sheet = createPageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][17])).toBe('N/A');
	});

	it('includes SEO metadata', async () => {
		const page = createMockPage({
			description: 'A test page',
			keywords: 'test, example',
			noindex: true,
			nofollow: false,
			noarchive: true,
			canonical: 'https://example.com/',
			alternate: 'https://example.com/en/',
			twitter_card: 'summary',
			og_site_name: 'Example Site',
			og_url: 'https://example.com/',
			og_title: 'OG Title',
			og_description: 'OG Description',
			og_type: 'website',
			og_image: 'https://example.com/og.png',
		});

		const sheet = createPageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		const row = rows![0];
		expect(cellValue(row[23])).toBe('A test page'); // description
		expect(cellValue(row[24])).toBe('test, example'); // keywords
		expect(cellValue(row[25])).toBe(true); // noindex
		expect(cellValue(row[26])).toBe(false); // nofollow
		expect(cellValue(row[27])).toBe(true); // noarchive
		expect(cellValue(row[28])).toBe('https://example.com/'); // canonical
		expect(cellValue(row[29])).toBe('https://example.com/en/'); // alternate
		expect(cellValue(row[30])).toBe('summary'); // twitter:card
		expect(cellValue(row[31])).toBe('Example Site'); // og:site_name
		// og:url has hyperlink so uses formulaValue
		expect(row[32].provide().hyperlink).toBe('https://example.com/'); // og:url
		expect(cellValue(row[33])).toBe('OG Title'); // og:title
		expect(cellValue(row[34])).toBe('OG Description'); // og:description
		expect(cellValue(row[35])).toBe('website'); // og:type
		expect(cellValue(row[36])).toBe('https://example.com/og.png'); // og:image
	});

	it('shows redirect count and URLs', async () => {
		const page = createMockPage({
			redirectFrom: [
				{ url: 'https://example.com/old1', pageId: 1 },
				{ url: 'https://example.com/old2', pageId: 2 },
			],
		});

		const sheet = createPageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][16])).toBe(2);
		expect(cellNote(rows![0][16])).toBe(
			'https://example.com/old1\nhttps://example.com/old2',
		);
	});

	it('uses -1 fallback when status is null', async () => {
		const page = createMockPage({ status: null });
		const sheet = createPageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][15])).toBe(-1);
	});

	it('adds plugin report data columns', async () => {
		const reports: Report[] = [
			{
				name: 'plugin-a',
				pageData: {
					headers: { score: 'Score', grade: 'Grade' },
					data: {
						'https://example.com/': { score: { value: 95 }, grade: { value: 'A' } },
					},
				},
			},
		];

		const page = createMockPage();
		const sheet = createPageList(reports);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		const row = rows![0];
		// Plugin columns start after the 37 base columns (index 37+)
		expect(cellValue(row[37])).toBe(95);
		expect(cellValue(row[38])).toBe('A');
	});

	it('applies report pageData options (bold, fontFamily, fontSize, italic, strike, underline)', async () => {
		const reports: Report[] = [
			{
				name: 'plugin-a',
				pageData: {
					headers: { col1: 'Col1' },
					data: {
						'https://example.com/': { col1: { value: 'styled' } },
					},
					options: {
						'https://example.com/': {
							col1: {
								bold: true,
								fontFamily: 'Arial',
								fontSize: 14,
								italic: true,
								strike: true,
								underline: true,
							},
						},
					},
				},
			},
		];

		const page = createMockPage();
		const sheet = createPageList(reports);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		const row = rows![0];
		const provided = row[37].provide();
		expect(provided.userEnteredFormat.textFormat).toEqual(
			expect.objectContaining({
				bold: true,
				fontFamily: 'Arial',
				fontSize: 14,
				italic: true,
				strikethrough: true,
				underline: true,
			}),
		);
	});

	it('title shortening removes index title and separator characters', async () => {
		// First call: register index title for dirname "/"
		const indexPage = createMockPage({
			url: {
				href: 'https://example.com/',
				protocol: 'https:',
				hostname: 'example.com',
				paths: [''],
				depth: 0,
				dirname: null,
				basename: '',
				isIndex: true,
				query: '',
			},
			title: 'Example Site',
		});

		const sheet = createPageList([]);
		await sheet.eachPage!(indexPage, 1, 2, null);

		// Second call: child page with site title in its title
		const childPage = createMockPage({
			url: {
				href: 'https://example.com/about',
				protocol: 'https:',
				hostname: 'example.com',
				paths: ['about'],
				depth: 1,
				dirname: '/',
				basename: 'about',
				isIndex: false,
				query: '',
			},
			title: 'About Us | Example Site',
			getReferrers: vi.fn().mockResolvedValue([]),
		});

		const rows = await sheet.eachPage!(childPage, 2, 2, indexPage as never);

		// Title should have "Example Site" removed and "|" stripped
		expect(cellValue(rows![0][0])).toBe('About Us');
	});

	it('preserves original title when shortening would result in empty string', async () => {
		const indexPage = createMockPage({
			url: {
				href: 'https://example.com/',
				protocol: 'https:',
				hostname: 'example.com',
				paths: [''],
				depth: 0,
				dirname: null,
				basename: '',
				isIndex: true,
				query: '',
			},
			title: 'Example Site',
		});

		const sheet = createPageList([]);
		await sheet.eachPage!(indexPage, 1, 2, null);

		const childPage = createMockPage({
			url: {
				href: 'https://example.com/about',
				protocol: 'https:',
				hostname: 'example.com',
				paths: ['about'],
				depth: 1,
				dirname: '/',
				basename: 'about',
				isIndex: false,
				query: '',
			},
			// Title IS the index title — removing it would leave empty
			title: 'Example Site',
			getReferrers: vi.fn().mockResolvedValue([]),
		});

		const rows = await sheet.eachPage!(childPage, 2, 2, indexPage as never);

		// Should preserve original title
		expect(cellValue(rows![0][0])).toBe('Example Site');
	});

	it('includes Full Title in second column', async () => {
		const page = createMockPage({ title: 'Full Page Title | Site Name' });
		const sheet = createPageList([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][1])).toBe('Full Page Title | Site Name');
	});

	it('accumulates indexRefs for index pages and aggregates referrer count', async () => {
		const sheet = createPageList([]);

		// First index page for /about/
		const aboutIndex = createMockPage({
			url: {
				href: 'https://example.com/about/',
				protocol: 'https:',
				hostname: 'example.com',
				paths: ['about', ''],
				depth: 2,
				dirname: '/about',
				basename: '',
				isIndex: true,
				query: '',
			},
			title: 'About',
			getReferrers: vi.fn().mockResolvedValue([
				{
					url: 'https://example.com/',
					through: 'https://example.com/',
					hash: null,
					textContent: 'About',
				},
			]),
		});

		await sheet.eachPage!(aboutIndex, 1, 2, null);

		// Second index page for /about/ (e.g., index.html with basename)
		const aboutIndexHtml = createMockPage({
			url: {
				href: 'https://example.com/about/index.html',
				protocol: 'https:',
				hostname: 'example.com',
				paths: ['about', 'index.html'],
				depth: 2,
				dirname: '/about',
				basename: 'index.html',
				isIndex: true,
				query: '',
			},
			title: 'About',
			getReferrers: vi.fn().mockResolvedValue([
				{
					url: 'https://example.com/contact',
					through: 'https://example.com/contact',
					hash: null,
					textContent: 'About',
				},
				{
					url: 'https://example.com/help',
					through: 'https://example.com/help',
					hash: null,
					textContent: 'About',
				},
			]),
		});

		const rows = await sheet.eachPage!(aboutIndexHtml, 2, 2, aboutIndex as never);

		// Internal Referrers should aggregate across both index pages
		// The cell is a LazyCell — call provide() directly
		const referrerCell = rows![0][22];
		const provided = referrerCell.provide();
		// Total referrers: 1 (aboutIndex) + 2 (aboutIndexHtml) = 3
		expect(provided.userEnteredValue.numberValue).toBe(3);
	});

	it('calls frozen, conditionalFormat, and hideCol in updateSheet', async () => {
		const mockSheet = {
			frozen: vi.fn().mockResolvedValue(),
			conditionalFormat: vi.fn().mockResolvedValue(),
			getColNumByHeaderName: vi.fn().mockReturnValue(1),
			hideCol: vi.fn().mockResolvedValue(),
		} as unknown as Sheet;

		const sheet = createPageList([]);

		// Process a page to set maxDepth
		const page = createMockPage({
			url: {
				href: 'https://example.com/a/b/',
				protocol: 'https:',
				hostname: 'example.com',
				paths: ['a', 'b', ''],
				depth: 3,
				dirname: '/a/b',
				basename: '',
				isIndex: true,
				query: '',
			},
		});
		await sheet.eachPage!(page, 1, 1, null);

		await sheet.updateSheet!(mockSheet);

		expect(mockSheet.frozen).toHaveBeenCalledWith(1, 1);
		expect(mockSheet.conditionalFormat).toHaveBeenCalledTimes(7);

		// maxDepth = 3, so path4-path10 (7 columns) should be hidden
		expect(mockSheet.hideCol).toHaveBeenCalledTimes(7);
	});

	it('hides unused path columns based on maxDepth', async () => {
		const mockSheet = {
			frozen: vi.fn().mockResolvedValue(),
			conditionalFormat: vi.fn().mockResolvedValue(),
			getColNumByHeaderName: vi.fn().mockImplementation((name: string) => {
				const map: Record<string, number> = {
					path1: 6,
					path2: 7,
					path3: 8,
					path4: 9,
					path5: 10,
					path6: 11,
					path7: 12,
					path8: 13,
					path9: 14,
					path10: 15,
				};
				return map[name] ?? 1;
			}),
			hideCol: vi.fn().mockResolvedValue(),
		} as unknown as Sheet;

		const sheet = createPageList([]);

		// Process page with depth 2
		const page = createMockPage({
			url: {
				href: 'https://example.com/a/',
				protocol: 'https:',
				hostname: 'example.com',
				paths: ['a', ''],
				depth: 2,
				dirname: '/a',
				basename: '',
				isIndex: true,
				query: '',
			},
		});
		await sheet.eachPage!(page, 1, 1, null);
		await sheet.updateSheet!(mockSheet);

		// maxDepth = 2, so path3-path10 (8 columns) should be hidden
		expect(mockSheet.hideCol).toHaveBeenCalledTimes(8);
		expect(mockSheet.getColNumByHeaderName).toHaveBeenCalledWith('path3');
		expect(mockSheet.getColNumByHeaderName).toHaveBeenCalledWith('path10');
	});

	it('skips report columns when pageData has no entry for the page URL', async () => {
		const reports: Report[] = [
			{
				name: 'plugin-a',
				pageData: {
					headers: { score: 'Score' },
					data: {
						'https://other.com/': { score: { value: 50 } },
					},
				},
			},
		];

		const page = createMockPage();
		const sheet = createPageList(reports);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		// Row should have base 37 columns only — no plugin column appended
		expect(rows![0]).toHaveLength(37);
	});

	it('uses option.note when data.note is absent', async () => {
		const reports: Report[] = [
			{
				name: 'plugin-a',
				pageData: {
					headers: { col1: 'Col1' },
					data: {
						'https://example.com/': { col1: { value: 'val' } },
					},
					options: {
						'https://example.com/': {
							col1: { note: 'option note text' },
						},
					},
				},
			},
		];

		const page = createMockPage();
		const sheet = createPageList(reports);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		const provided = rows![0][37].provide();
		expect(provided.note).toBe('option note text');
	});
});
