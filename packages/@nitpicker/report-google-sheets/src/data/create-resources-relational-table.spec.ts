import type { Sheet } from '@d-zero/google-sheets';
import type { ArchiveResource as Resource } from '@nitpicker/crawler';

import { describe, it, expect, vi } from 'vitest';

import { createResourcesRelationalTable } from './create-resources-relational-table.js';

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

describe('createResourcesRelationalTable', () => {
	it('returns sheet config with name "Resources Relational Table"', () => {
		const sheet = createResourcesRelationalTable([]);
		expect(sheet.name).toBe('Resources Relational Table');
	});

	it('returns correct headers', () => {
		const sheet = createResourcesRelationalTable([]);
		const headers = sheet.createHeaders();
		expect(headers).toEqual([
			'Referred Page (From)',
			'Resource (To)',
			'Resource Status Code',
			'Resource Status Text',
			'Resource Content Type',
			'Resource Size',
		]);
	});

	it('generates one row per referrer', async () => {
		const resource = createMockResource({
			getReferrers: vi
				.fn()
				.mockResolvedValue([
					'https://example.com/',
					'https://example.com/about',
					'https://example.com/contact',
				]),
		});

		const sheet = createResourcesRelationalTable([]);
		const rows = await sheet.eachResource!(resource);

		expect(rows).toHaveLength(3);
	});

	it('includes referrer URL and resource metadata in each row', async () => {
		const resource = createMockResource({
			url: 'https://cdn.example.com/app.js',
			status: 304,
			statusText: 'Not Modified',
			contentType: 'application/javascript',
			contentLength: 12_345,
			getReferrers: vi.fn().mockResolvedValue(['https://example.com/']),
		});

		const sheet = createResourcesRelationalTable([]);
		const rows = await sheet.eachResource!(resource);

		expect(rows).toHaveLength(1);
		const row = rows![0];
		expect(row).toHaveLength(6);

		// Referred Page (From) - has hyperlink
		expect(row[0].provide().hyperlink).toBe('https://example.com/');
		// Resource (To)
		expect(cellValue(row[1])).toBe('https://cdn.example.com/app.js');
		// Resource Status Code
		expect(cellValue(row[2])).toBe(304);
		// Resource Status Text
		expect(cellValue(row[3])).toBe('Not Modified');
		// Resource Content Type
		expect(cellValue(row[4])).toBe('application/javascript');
		// Resource Size
		expect(cellValue(row[5])).toBe(12_345);
	});

	it('returns empty array when resource has no referrers', async () => {
		const resource = createMockResource();
		const sheet = createResourcesRelationalTable([]);
		const rows = await sheet.eachResource!(resource);

		expect(rows).toEqual([]);
	});

	it('calls frozen and conditionalFormat in updateSheet', async () => {
		const mockSheet = {
			frozen: vi.fn().mockResolvedValue(),
			conditionalFormat: vi.fn().mockResolvedValue(),
			getColNumByHeaderName: vi.fn().mockReturnValue(3),
		} as unknown as Sheet;

		const sheet = createResourcesRelationalTable([]);
		await sheet.updateSheet!(mockSheet);

		expect(mockSheet.frozen).toHaveBeenCalledWith(2, 1);
		expect(mockSheet.conditionalFormat).toHaveBeenCalledTimes(2);
		expect(mockSheet.getColNumByHeaderName).toHaveBeenCalledWith('Resource Status Code');
	});

	it('applies NUMBER_GREATER_THAN_EQ 400 conditional format', async () => {
		const mockSheet = {
			frozen: vi.fn().mockResolvedValue(),
			conditionalFormat: vi.fn().mockResolvedValue(),
			getColNumByHeaderName: vi.fn().mockReturnValue(3),
		} as unknown as Sheet;

		const sheet = createResourcesRelationalTable([]);
		await sheet.updateSheet!(mockSheet);

		const firstCall = vi.mocked(mockSheet.conditionalFormat).mock.calls[0];
		expect(firstCall[1]).toEqual(
			expect.objectContaining({
				booleanRule: expect.objectContaining({
					condition: expect.objectContaining({
						type: 'NUMBER_GREATER_THAN_EQ',
						values: [{ userEnteredValue: '400' }],
					}),
				}),
			}),
		);
	});

	it('applies NUMBER_NOT_BETWEEN 200-399 conditional format', async () => {
		const mockSheet = {
			frozen: vi.fn().mockResolvedValue(),
			conditionalFormat: vi.fn().mockResolvedValue(),
			getColNumByHeaderName: vi.fn().mockReturnValue(3),
		} as unknown as Sheet;

		const sheet = createResourcesRelationalTable([]);
		await sheet.updateSheet!(mockSheet);

		const secondCall = vi.mocked(mockSheet.conditionalFormat).mock.calls[1];
		expect(secondCall[1]).toEqual(
			expect.objectContaining({
				booleanRule: expect.objectContaining({
					condition: expect.objectContaining({
						type: 'NUMBER_NOT_BETWEEN',
						values: [{ userEnteredValue: '200' }, { userEnteredValue: '399' }],
					}),
				}),
			}),
		);
	});
});
