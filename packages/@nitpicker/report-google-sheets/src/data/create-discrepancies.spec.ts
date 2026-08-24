import type { Report } from '@nitpicker/types';

import { describe, it, expect } from 'vitest';

import { assertNoLazyCells } from '../test-helpers/assert-no-lazy-cells.js';
import { cellNote, cellValue } from '../test-helpers/cell-inspection.js';
import { createMockSheet } from '../test-helpers/create-mock-sheet.js';

import { createDiscrepancies } from './create-discrepancies.js';

const NO_ACCESSOR = undefined as never;

describe('createDiscrepancies', () => {
	it('returns sheet config with name "Discrepancies"', () => {
		const setting = createDiscrepancies([], NO_ACCESSOR);
		expect(setting.name).toBe('Discrepancies');
	});

	it('returns correct headers', () => {
		const setting = createDiscrepancies([], NO_ACCESSOR);
		const headers = setting.createHeaders();
		expect(headers).toEqual(['Type', 'Left URL', 'Left', 'Right', 'Right URL', 'Note']);
	});

	it('estimates the row count as the total discrepancy count across every report', () => {
		const reports: Report[] = [
			{ name: 'a', discrepancies: [{ left: '1' } as never, { left: '2' } as never] },
			{ name: 'b', discrepancies: [{ left: '3' } as never] },
		];
		const setting = createDiscrepancies(reports, NO_ACCESSOR);
		expect(setting.estimateRowCount()).toBe(3);
	});

	it('uses only eager cells so appendRow can stream (no lazy thunks)', async () => {
		const reports: Report[] = [
			{
				name: 'meta-check',
				discrepancies: [
					{
						leftSourceUrl: 'https://example.com/',
						left: 'OG Title',
						right: 'Page Title',
						rightSourceUrl: 'https://example.com/',
						note: 'Title mismatch',
					},
				],
			},
		];
		const setting = createDiscrepancies(reports, NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });
		assertNoLazyCells(mock.rows);
	});

	it('generates one row per discrepancy, mapping fields to the documented columns', async () => {
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
		const setting = createDiscrepancies(reports, NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });

		expect(mock.rows).toHaveLength(1);
		const row = mock.rows[0]!;
		expect(cellValue(row[0]!)).toBe('meta-check');
		expect(cellValue(row[1]!)).toBe('https://example.com/');
		expect(cellNote(row[1]!)).toBe('note-left-url');
		expect(cellValue(row[2]!)).toBe('Left Value');
		expect(cellNote(row[2]!)).toBe('note-left');
		expect(cellValue(row[3]!)).toBe('Right Value');
		expect(cellNote(row[3]!)).toBe('note-right');
		expect(cellValue(row[4]!)).toBe('https://example.com/other');
		expect(cellNote(row[4]!)).toBe('note-right-url');
		expect(cellValue(row[5]!)).toBe('Main note');
	});

	it('skips reports without discrepancies', async () => {
		const reports: Report[] = [{ name: 'no-discrepancies' }];
		const setting = createDiscrepancies(reports, NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });
		expect(mock.rows).toHaveLength(0);
	});

	it('handles multiple reports with multiple discrepancies, in order', async () => {
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
		const setting = createDiscrepancies(reports, NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });

		expect(mock.rows).toHaveLength(3);
		expect(cellValue(mock.rows[0]![0]!)).toBe('check-1');
		expect(cellValue(mock.rows[1]![0]!)).toBe('check-1');
		expect(cellValue(mock.rows[2]![0]!)).toBe('check-2');
	});

	it('stops sending rows once maxRows is reached', async () => {
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
		];
		const setting = createDiscrepancies(reports, NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: 1, onProgress: () => {} });
		expect(mock.rows).toHaveLength(1);
		expect(mock.flushCount).toBe(1);
	});
});
