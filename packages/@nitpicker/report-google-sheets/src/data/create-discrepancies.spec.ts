import type { Page } from '@nitpicker/crawler';
import type { Report } from '@nitpicker/types';

import { Cell } from '@d-zero/google-sheets';
import { describe, it, expect, vi } from 'vitest';

import { createDiscrepancies } from './create-discrepancies.js';

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

describe('createDiscrepancies', () => {
	it('returns sheet config with name "Discrepancies"', () => {
		const sheet = createDiscrepancies([]);
		expect(sheet.name).toBe('Discrepancies');
	});

	it('does not opt into bufferRows so rows stream out incrementally', () => {
		// No lazy cells — streaming keeps peak memory bounded.
		const sheet = createDiscrepancies([]);
		expect(sheet.bufferRows).toBeFalsy();
	});

	it('returns only eager cells from eachPage (streaming requires no lazy thunks)', async () => {
		// See create-links.spec.ts for the rationale.
		const page = createMockPage({
			getAnchors: vi.fn().mockResolvedValue([
				{
					textContent: 'About',
					title: 'About Page',
					url: 'https://example.com/about',
				},
			]),
		});
		const sheet = createDiscrepancies([]);
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
		const sheet = createDiscrepancies([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual(['Type', 'Left URL', 'Left', 'Right', 'Right URL', 'Note']);
	});

	describe('eachPage', () => {
		it('generates one row per anchor', async () => {
			const page = createMockPage({
				url: { href: 'https://example.com/page1' },
				getAnchors: vi.fn().mockResolvedValue([
					{
						textContent: 'About Us',
						title: 'About Page',
						url: 'https://example.com/about',
					},
					{
						textContent: 'Contact',
						title: 'Contact Page',
						url: 'https://example.com/contact',
					},
				]),
			});

			const sheet = createDiscrepancies([]);
			const rows = await sheet.eachPage!(page, 1, 1, null);

			expect(rows).toHaveLength(2);
			expect(rows![0]).toHaveLength(6);
			expect(rows![1]).toHaveLength(6);
		});

		it('sets correct cell values for anchor row', async () => {
			const page = createMockPage({
				url: { href: 'https://example.com/page1' },
				getAnchors: vi.fn().mockResolvedValue([
					{
						textContent: 'Link Text',
						title: 'Page Title',
						url: 'https://example.com/target',
					},
				]),
			});

			const sheet = createDiscrepancies([]);
			const rows = await sheet.eachPage!(page, 1, 1, null);

			const row = rows![0];
			// Type
			expect(cellValue(row[0])).toBe('Link Text vs Page Title');
			// Left URL (page URL)
			expect(cellValue(row[1])).toBe('https://example.com/page1');
			// Left (anchor textContent)
			expect(cellValue(row[2])).toBe('Link Text');
			// Right (anchor title)
			expect(cellValue(row[3])).toBe('Page Title');
			// Right URL (anchor url)
			expect(cellValue(row[4])).toBe('https://example.com/target');
			// Note (empty)
			expect(cellValue(row[5])).toBe('');
		});

		it('returns empty array when no anchors', async () => {
			const page = createMockPage();
			const sheet = createDiscrepancies([]);
			const rows = await sheet.eachPage!(page, 1, 1, null);

			expect(rows).toEqual([]);
		});

		it('handles anchors with empty textContent and title', async () => {
			const page = createMockPage({
				url: { href: 'https://example.com/' },
				getAnchors: vi
					.fn()
					.mockResolvedValue([
						{ textContent: '', title: '', url: 'https://example.com/target' },
					]),
			});

			const sheet = createDiscrepancies([]);
			const rows = await sheet.eachPage!(page, 1, 1, null);

			expect(rows).toHaveLength(1);
			expect(cellValue(rows![0][2])).toBe('');
			expect(cellValue(rows![0][3])).toBe('');
		});
	});

	describe('addRows', () => {
		it('generates 6-cell rows matching header count', () => {
			const reports: Report[] = [
				{
					name: 'meta-check',
					discrepancies: [
						{
							leftSourceUrl: 'https://example.com/',
							leftSourceUrlNote: 'og:title',
							left: 'OG Title',
							leftNote: 'from og tag',
							right: 'Page Title',
							rightNote: 'from title tag',
							rightSourceUrl: 'https://example.com/',
							rightSourceUrlNote: 'title',
							note: 'Title mismatch',
						},
					],
				},
			];

			const sheet = createDiscrepancies(reports);
			const rows = sheet.addRows!();

			expect(rows).toHaveLength(1);
			expect(rows![0]).toHaveLength(6);
		});

		it('uses report name as Type column and maps discrepancy fields correctly', () => {
			const reports: Report[] = [
				{
					name: 'meta-check',
					discrepancies: [
						{
							leftSourceUrl: 'https://example.com/',
							leftSourceUrlNote: 'note-left-url',
							left: 'Left Value',
							leftNote: 'note-left',
							right: 'Right Value',
							rightNote: 'note-right',
							rightSourceUrl: 'https://example.com/other',
							rightSourceUrlNote: 'note-right-url',
							note: 'Main note',
						},
					],
				},
			];

			const sheet = createDiscrepancies(reports);
			const rows = sheet.addRows!();

			const row = rows![0];
			// Type (report name)
			expect(cellValue(row[0])).toBe('meta-check');
			// Left URL (leftSourceUrl with leftSourceUrlNote as note)
			expect(cellValue(row[1])).toBe('https://example.com/');
			expect(cellNote(row[1])).toBe('note-left-url');
			// Left (left with leftNote as note)
			expect(cellValue(row[2])).toBe('Left Value');
			expect(cellNote(row[2])).toBe('note-left');
			// Right (right with rightNote as note)
			expect(cellValue(row[3])).toBe('Right Value');
			expect(cellNote(row[3])).toBe('note-right');
			// Right URL (rightSourceUrl with rightSourceUrlNote as note)
			expect(cellValue(row[4])).toBe('https://example.com/other');
			expect(cellNote(row[4])).toBe('note-right-url');
			// Note
			expect(cellValue(row[5])).toBe('Main note');
		});

		it('skips reports without discrepancies', () => {
			const reports: Report[] = [{ name: 'no-discrepancies' }];
			const sheet = createDiscrepancies(reports);
			const rows = sheet.addRows!();

			expect(rows).toHaveLength(0);
		});

		it('handles multiple reports with multiple discrepancies', () => {
			const reports: Report[] = [
				{
					name: 'check-1',
					discrepancies: [
						{
							leftSourceUrl: 'url1',
							left: 'a',
							right: 'b',
							rightSourceUrl: 'url2',
							note: 'n1',
						},
						{
							leftSourceUrl: 'url3',
							left: 'c',
							right: 'd',
							rightSourceUrl: 'url4',
							note: 'n2',
						},
					],
				},
				{
					name: 'check-2',
					discrepancies: [
						{
							leftSourceUrl: 'url5',
							left: 'e',
							right: 'f',
							rightSourceUrl: 'url6',
							note: 'n3',
						},
					],
				},
			];

			const sheet = createDiscrepancies(reports);
			const rows = sheet.addRows!();

			expect(rows).toHaveLength(3);
			// Each report name appears in the Type column
			expect(cellValue(rows![0][0])).toBe('check-1');
			expect(cellValue(rows![1][0])).toBe('check-1');
			expect(cellValue(rows![2][0])).toBe('check-2');
		});
	});
});
