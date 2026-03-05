import type { Report } from '@nitpicker/types';

import { describe, it, expect } from 'vitest';

import { createDiscrepancies } from './create-discrepancies.js';

describe('createDiscrepancies', () => {
	it('returns sheet config with name "Discrepancies"', () => {
		const sheet = createDiscrepancies([]);
		expect(sheet.name).toBe('Discrepancies');
	});

	it('returns correct headers', () => {
		const sheet = createDiscrepancies([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual(['Type', 'Left URL', 'Left', 'Right', 'Right URL', 'Note']);
	});

	it('returns empty rows from addRows when no reports have discrepancies', () => {
		const reports: Report[] = [{ name: 'test' }];
		const sheet = createDiscrepancies(reports);
		const rows = sheet.addRows!();
		expect(rows).toHaveLength(0);
	});

	it('generates rows from report discrepancies via addRows', () => {
		const reports: Report[] = [
			{
				name: 'test',
				discrepancies: [
					{
						leftSourceUrl: 'https://example.com/a',
						leftSourceUrlNote: 'note-a',
						left: 'Left value',
						leftNote: 'left-note',
						right: 'Right value',
						rightNote: 'right-note',
						rightSourceUrl: 'https://example.com/b',
						rightSourceUrlNote: 'note-b',
						note: 'Discrepancy note',
					},
				],
			},
		];
		const sheet = createDiscrepancies(reports);
		const rows = sheet.addRows!();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toHaveLength(5);
	});

	it('skips reports without discrepancies in addRows', () => {
		const reports: Report[] = [
			{ name: 'no-discrepancies' },
			{
				name: 'has-discrepancies',
				discrepancies: [
					{
						leftSourceUrl: 'a',
						left: 'b',
						right: 'c',
						rightSourceUrl: 'd',
						note: 'e',
					},
				],
			},
		];
		const sheet = createDiscrepancies(reports);
		const rows = sheet.addRows!();
		expect(rows).toHaveLength(1);
	});
});
