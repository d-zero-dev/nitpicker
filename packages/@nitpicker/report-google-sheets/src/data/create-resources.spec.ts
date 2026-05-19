import type { ArchiveResource as Resource } from '@nitpicker/crawler';

import { Cell } from '@d-zero/google-sheets';
import { describe, it, expect, vi } from 'vitest';

import { createResources } from './create-resources.js';

/**
 * Creates a mock ArchiveResource object with sensible defaults for testing.
 * @param overrides - Properties to override on the default mock resource.
 * @returns A mock Resource instance cast via `as never`.
 */
function createMockResource(overrides: Partial<Record<string, unknown>> = {}): Resource {
	return {
		url: 'https://example.com/style.css',
		status: 200,
		statusText: 'OK',
		contentType: 'text/css',
		contentLength: 5000,
		isExternal: false,
		getReferrers: vi.fn().mockResolvedValue([]),
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

describe('createResources', () => {
	it('returns sheet config with name "Resources"', () => {
		const sheet = createResources([]);
		expect(sheet.name).toBe('Resources');
	});

	it('uses only eager cells from eachResource so appendRow can stream', async () => {
		// A lazy cell here would force appendRow() into buffered mode for the
		// entire resource batch, defeating the streaming throughput. Phase 3
		// has no lazy-cell users today; this guard keeps it that way.
		const resource = createMockResource();
		const sheet = createResources([]);
		const rows = await sheet.eachResource!(resource);
		expect(rows).toBeTruthy();
		expect(rows!.length).toBeGreaterThan(0);
		for (const row of rows!) {
			for (const cell of row) {
				expect(cell.provide).toBe(Cell.prototype.provide);
			}
		}
	});

	it('returns correct headers', () => {
		const sheet = createResources([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual([
			'URL',
			'Status Code',
			'Status Text',
			'Content Type',
			'Content Length',
			'Referrers',
		]);
	});

	it('generates row with resource data and referrer count', async () => {
		const resource = createMockResource({
			getReferrers: vi
				.fn()
				.mockResolvedValue([
					'https://example.com/',
					'https://example.com/about',
					'https://example.com/contact',
				]),
		});

		const sheet = createResources([]);
		const rows = await sheet.eachResource!(resource);

		expect(rows).toHaveLength(1);
		expect(rows![0]).toHaveLength(6);

		expect(cellValue(rows![0][0])).toBe('https://example.com/style.css');
		expect(cellValue(rows![0][1])).toBe(200);
		expect(cellValue(rows![0][2])).toBe('OK');
		expect(cellValue(rows![0][3])).toBe('text/css');
		expect(cellValue(rows![0][4])).toBe(5000);
		expect(cellValue(rows![0][5])).toBe('3 pages');
		expect(cellNote(rows![0][5])).toBe(
			'https://example.com/\nhttps://example.com/about\nhttps://example.com/contact',
		);
	});

	it('shows "0 pages" when resource has no referrers', async () => {
		const resource = createMockResource();
		const sheet = createResources([]);
		const rows = await sheet.eachResource!(resource);

		expect(rows).toHaveLength(1);
		expect(cellValue(rows![0][5])).toBe('0 pages');
		expect(cellNote(rows![0][5])).toBe('');
	});

	it('passes null status and contentType as-is', async () => {
		const resource = createMockResource({
			status: null,
			statusText: null,
			contentType: null,
			contentLength: null,
		});

		const sheet = createResources([]);
		const rows = await sheet.eachResource!(resource);

		// null values become empty strings in Cell
		expect(cellValue(rows![0][1])).toBe('');
		expect(cellValue(rows![0][2])).toBe('');
		expect(cellValue(rows![0][3])).toBe('');
		expect(cellValue(rows![0][4])).toBe('');
	});

	it('returns single-row array', async () => {
		const resource = createMockResource({
			getReferrers: vi.fn().mockResolvedValue(['https://example.com/']),
		});
		const sheet = createResources([]);
		const rows = await sheet.eachResource!(resource);

		expect(rows).toHaveLength(1);
		expect(Array.isArray(rows![0])).toBe(true);
	});
});
