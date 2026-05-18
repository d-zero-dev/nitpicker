import type { Sheet } from '@d-zero/google-sheets';
import type { Page } from '@nitpicker/crawler';

import { Cell } from '@d-zero/google-sheets';
import { describe, it, expect, vi } from 'vitest';

import { createReferrersRelationalTable } from './create-referrers-relational-table.js';

/**
 * Creates a mock Page object with sensible defaults for testing.
 * @param overrides - Properties to override on the default mock page.
 * @returns A mock Page instance cast via `as never`.
 */
function createMockPage(overrides: Partial<Record<string, unknown>> = {}): Page {
	return {
		url: { href: 'https://example.com/' },
		title: 'Example',
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		isExternal: false,
		isTarget: true,
		isSkipped: false,
		skipReason: null,
		redirectFrom: [],
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

describe('createReferrersRelationalTable', () => {
	it('returns sheet config with name "Referrers Relational Table"', () => {
		const sheet = createReferrersRelationalTable([]);
		expect(sheet.name).toBe('Referrers Relational Table');
	});

	it('does not opt into bufferRows so rows stream out incrementally', () => {
		// No lazy cells — streaming is required to keep peak memory bounded
		// when a page yields many referrer rows.
		const sheet = createReferrersRelationalTable([]);
		expect(sheet.bufferRows).toBeFalsy();
	});

	it('returns only eager cells from eachPage (streaming requires no lazy thunks)', async () => {
		// See create-links.spec.ts for the rationale. Same defense-in-depth
		// check: streaming flushes provide() before sibling pages have run,
		// so a LazyCell here would corrupt the output silently.
		const sheet = createReferrersRelationalTable([]);
		const page = createMockPage({
			getReferrers: vi.fn().mockResolvedValue([
				{
					textContent: 'link text',
					url: 'https://example.com/from',
					hash: '',
					through: 'https://example.com/',
				},
			]),
		});
		const rows = await sheet.eachPage!(page, 1, 1, null);
		expect(rows).toBeTruthy();
		expect(rows!.length).toBeGreaterThan(0);
		for (const row of rows!) {
			for (const cell of row) {
				expect(cell.provide).toBe(Cell.prototype.provide);
			}
		}
	});

	it('returns correct headers', () => {
		const sheet = createReferrersRelationalTable([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual([
			'Link (To)',
			'Referrer (From)',
			'Referrer Content',
			'Link Status Code',
			'Link Status Text',
			'Link Content Type',
		]);
	});

	it('generates one row per referrer', async () => {
		const page = createMockPage({
			getReferrers: vi.fn().mockResolvedValue([
				{
					url: 'https://example.com/a',
					through: 'https://example.com/',
					hash: null,
					textContent: 'Link A',
				},
				{
					url: 'https://example.com/b',
					through: 'https://example.com/',
					hash: null,
					textContent: 'Link B',
				},
			]),
		});

		const sheet = createReferrersRelationalTable([]);
		const rows = await sheet.eachPage!(page, 1, 10, null);

		expect(rows).toHaveLength(2);
		expect(rows![0]).toHaveLength(6);
		expect(rows![1]).toHaveLength(6);
	});

	it('uses __NO_TEXT_CONTENT__ when referrer textContent is empty', async () => {
		const page = createMockPage({
			getReferrers: vi.fn().mockResolvedValue([
				{
					url: 'https://example.com/a',
					through: 'https://example.com/',
					hash: null,
					textContent: '',
				},
			]),
		});

		const sheet = createReferrersRelationalTable([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellValue(rows![0][2])).toBe('__NO_TEXT_CONTENT__');
	});

	it('appends hash to referrer URL when present', async () => {
		const page = createMockPage({
			getReferrers: vi.fn().mockResolvedValue([
				{
					url: 'https://example.com/a',
					through: 'https://example.com/',
					hash: 'section1',
					textContent: 'Link',
				},
			]),
		});

		const sheet = createReferrersRelationalTable([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(rows![0][1].provide().hyperlink).toBe('https://example.com/a#section1');
	});

	it('does not append hash when hash is null', async () => {
		const page = createMockPage({
			getReferrers: vi.fn().mockResolvedValue([
				{
					url: 'https://example.com/a',
					through: 'https://example.com/',
					hash: null,
					textContent: 'Link',
				},
			]),
		});

		const sheet = createReferrersRelationalTable([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(rows![0][1].provide().hyperlink).toBe('https://example.com/a');
	});

	it('adds [REDIRECTED FROM] note when through differs from page URL', async () => {
		const page = createMockPage({
			url: { href: 'https://example.com/final' },
			getReferrers: vi.fn().mockResolvedValue([
				{
					url: 'https://example.com/a',
					through: 'https://example.com/original',
					hash: null,
					textContent: 'Link',
				},
			]),
		});

		const sheet = createReferrersRelationalTable([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellNote(rows![0][0])).toBe('[REDIRECTED FROM] https://example.com/original');
	});

	it('does not add note when through equals page URL', async () => {
		const page = createMockPage({
			url: { href: 'https://example.com/' },
			getReferrers: vi.fn().mockResolvedValue([
				{
					url: 'https://example.com/a',
					through: 'https://example.com/',
					hash: null,
					textContent: 'Link',
				},
			]),
		});

		const sheet = createReferrersRelationalTable([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(cellNote(rows![0][0])).toBeUndefined();
	});

	it('returns empty array when page has no referrers', async () => {
		const page = createMockPage();
		const sheet = createReferrersRelationalTable([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		expect(rows).toEqual([]);
	});

	it('uses fallback values when page status/statusText/contentType are null', async () => {
		const page = createMockPage({
			status: null,
			statusText: null,
			contentType: null,
			getReferrers: vi.fn().mockResolvedValue([
				{
					url: 'https://example.com/a',
					through: 'https://example.com/',
					hash: null,
					textContent: 'Link',
				},
			]),
		});

		const sheet = createReferrersRelationalTable([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		// status null → -1 fallback
		expect(cellValue(rows![0][3])).toBe(-1);
		// statusText null → '' fallback
		expect(cellValue(rows![0][4])).toBe('');
		// contentType null → '' fallback
		expect(cellValue(rows![0][5])).toBe('');
	});

	it('includes page URL with hyperlink in Link (To) column', async () => {
		const page = createMockPage({
			url: { href: 'https://example.com/target' },
			getReferrers: vi.fn().mockResolvedValue([
				{
					url: 'https://example.com/a',
					through: 'https://example.com/target',
					hash: null,
					textContent: 'Link',
				},
			]),
		});

		const sheet = createReferrersRelationalTable([]);
		const rows = await sheet.eachPage!(page, 1, 1, null);

		// The Link (To) cell has textFormat.link, so it renders as a hyperlink formula
		expect(rows![0][0].provide().hyperlink).toBe('https://example.com/target');
	});

	it('calls frozen and conditionalFormat in updateSheet', async () => {
		const mockSheet = {
			frozen: vi.fn().mockResolvedValue(),
			conditionalFormat: vi.fn().mockResolvedValue(),
			getColNumByHeaderName: vi.fn().mockReturnValue(4),
		} as unknown as Sheet;

		const sheet = createReferrersRelationalTable([]);
		await sheet.updateSheet!(mockSheet);

		expect(mockSheet.frozen).toHaveBeenCalledWith(2, 1);
		expect(mockSheet.conditionalFormat).toHaveBeenCalledTimes(2);
		expect(mockSheet.getColNumByHeaderName).toHaveBeenCalledWith('Link Status Code');
	});
});
