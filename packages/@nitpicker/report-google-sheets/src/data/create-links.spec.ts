import type { Sheet } from '@d-zero/google-sheets';
import type { Page } from '@nitpicker/crawler';

import { Cell } from '@d-zero/google-sheets';
import { describe, it, expect, vi } from 'vitest';

import { createLinks } from './create-links.js';

/**
 * Creates a mock Page object with sensible defaults for testing.
 * @param overrides - Properties to override on the default mock page.
 * @returns A mock Page instance cast via `as never`.
 */
function createMockPage(overrides: Partial<Record<string, unknown>> = {}): Page {
	return {
		url: { href: 'https://example.com/' },
		title: 'Example Page',
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		isExternal: false,
		isTarget: true,
		isSkipped: false,
		skipReason: null,
		redirectFrom: [],
		responseHeaders: { 'content-type': 'text/html' },
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

describe('createLinks', () => {
	it('returns sheet config with name "Links"', () => {
		const sheet = createLinks([]);
		expect(sheet.name).toBe('Links');
	});

	it('uses only eager cells from eachPage so appendRow can stream', async () => {
		// LazyCell overrides provide(); any cell whose provide() differs from
		// Cell.prototype.provide is a thunk depending on shared mutable state.
		// `@d-zero/google-sheets`' appendRow() auto-buffers when it detects a
		// lazy row, which would degrade Links into batched sends. Asserting
		// that Links has no lazy cells keeps the streaming fast path active.
		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(createMockPage(), 1, 1, null);
		expect(rows).toBeTruthy();
		for (const row of rows!) {
			for (const cell of row) {
				expect(cell.provide).toBe(Cell.prototype.provide);
			}
		}
	});

	it('returns correct headers', () => {
		const sheet = createLinks([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual([
			'URL',
			'Page Title',
			'Status Code',
			'Status Text',
			'Content Type',
			'Redirect From',
			'Referrers',
			'Headers',
			'Remarks',
		]);
	});

	it('generates row with basic page data', async () => {
		const page = createMockPage();
		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(rows).toHaveLength(1);
		expect(rows![0]).toHaveLength(9);

		// URL (has hyperlink — verify via hyperlink property)
		expect(rows![0][0].provide().hyperlink).toBe('https://example.com/');
		// Status Code
		expect(cellValue(rows![0][2])).toBe(200);
		// Status Text
		expect(cellValue(rows![0][3])).toBe('OK');
		// Content Type
		expect(cellValue(rows![0][4])).toBe('text/html');
	});

	it('uses "-" fallback when title is empty', async () => {
		const page = createMockPage({ title: '' });
		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][1])).toBe('-');
	});

	it('uses -1 fallback when status is null', async () => {
		const page = createMockPage({ status: null });
		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][2])).toBe(-1);
	});

	it('uses empty string fallback when statusText is null', async () => {
		const page = createMockPage({ statusText: null });
		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][3])).toBe('');
	});

	it('uses empty string fallback when contentType is null', async () => {
		const page = createMockPage({ contentType: null });
		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][4])).toBe('');
	});

	it('shows redirect count and URLs in note', async () => {
		const page = createMockPage({
			redirectFrom: [
				{ url: 'https://example.com/old1', pageId: 1 },
				{ url: 'https://example.com/old2', pageId: 2 },
			],
		});

		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][5])).toBe(2);
		expect(cellNote(rows![0][5])).toBe(
			'https://example.com/old1\nhttps://example.com/old2',
		);
	});

	it('formats referrer text and URL correctly', async () => {
		const page = createMockPage({
			getReferrers: vi.fn().mockResolvedValue([
				{
					textContent: 'Home Link',
					url: 'https://example.com/from',
					hash: '',
					through: 'https://example.com/',
				},
			]),
		});

		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][6])).toBe('1 Elements');
		expect(cellNote(rows![0][6])).toContain('Home Link (https://example.com/from)');
	});

	it('uses __NO_TEXT_CONTENT__ for referrer with empty textContent', async () => {
		const page = createMockPage({
			getReferrers: vi.fn().mockResolvedValue([
				{
					textContent: '',
					url: 'https://example.com/from',
					hash: null,
					through: 'https://example.com/',
				},
			]),
		});

		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellNote(rows![0][6])).toContain('__NO_TEXT_CONTENT__');
	});

	it('adds [REDIRECTED FROM] for referrer with different through URL', async () => {
		const page = createMockPage({
			url: { href: 'https://example.com/final' },
			getReferrers: vi.fn().mockResolvedValue([
				{
					textContent: 'Link',
					url: 'https://example.com/from',
					hash: null,
					through: 'https://example.com/original',
				},
			]),
		});

		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellNote(rows![0][6])).toContain(
			'[REDIRECTED FROM] https://example.com/original',
		);
	});

	it('includes hash in referrer URL when present', async () => {
		const page = createMockPage({
			getReferrers: vi.fn().mockResolvedValue([
				{
					textContent: 'Link',
					url: 'https://example.com/from',
					hash: 'section',
					through: 'https://example.com/',
				},
			]),
		});

		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellNote(rows![0][6])).toContain('https://example.com/from#section');
	});

	it('stores responseHeaders as JSON in note', async () => {
		const headers = { 'x-custom': 'value', 'content-type': 'text/html' };
		const page = createMockPage({ responseHeaders: headers });

		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellNote(rows![0][7])).toBe(JSON.stringify(headers, null, 2));
	});

	it('shows skip reason in remarks when page is skipped', async () => {
		const page = createMockPage({
			isSkipped: true,
			skipReason: 'robots.txt',
		});

		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][8])).toBe('robots.txt');
	});

	it('uses "skipped" fallback when skipReason is null', async () => {
		const page = createMockPage({
			isSkipped: true,
			skipReason: null,
		});

		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][8])).toBe('skipped');
	});

	it('shows empty remarks when page is not skipped', async () => {
		const page = createMockPage({ isSkipped: false });
		const sheet = createLinks([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][8])).toBe('');
	});

	it('calls frozen and conditionalFormat in updateSheet', async () => {
		const mockSheet = {
			frozen: vi.fn().mockResolvedValue(),
			conditionalFormat: vi.fn().mockResolvedValue(),
			getColNumByHeaderName: vi.fn().mockReturnValue(3),
		} as unknown as Sheet;

		const sheet = createLinks([]);
		await sheet.updateSheet!(mockSheet);

		expect(mockSheet.frozen).toHaveBeenCalledWith(2, 1);
		expect(mockSheet.conditionalFormat).toHaveBeenCalledTimes(2);
		expect(mockSheet.getColNumByHeaderName).toHaveBeenCalledWith('Status Code');
	});
});
