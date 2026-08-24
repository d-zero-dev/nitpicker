import { streamAnchorFactEdges } from '@nitpicker/query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { assertNoLazyCells } from '../test-helpers/assert-no-lazy-cells.js';
import { cellValue, cellNote } from '../test-helpers/cell-inspection.js';
import { createMockSheet } from '../test-helpers/create-mock-sheet.js';
import { oneChunk } from '../test-helpers/one-chunk.js';

import { createReferrersRelationalTable } from './create-referrers-relational-table.js';

vi.mock('@nitpicker/query', () => ({
	streamAnchorFactEdges: vi.fn(),
}));

const NO_ACCESSOR = { getKnex: () => ({}) } as never;

describe('createReferrersRelationalTable', () => {
	beforeEach(() => {
		vi.mocked(streamAnchorFactEdges).mockReset();
	});

	it('returns sheet config with name "Referrers Relational Table" and requiresReadModel', () => {
		const setting = createReferrersRelationalTable([], NO_ACCESSOR);
		expect(setting.name).toBe('Referrers Relational Table');
		expect(setting.requiresReadModel).toBe(true);
	});

	it('returns correct headers, including the new Count column', () => {
		const setting = createReferrersRelationalTable([], NO_ACCESSOR);
		expect(setting.createHeaders()).toEqual([
			'Link (To)',
			'Referrer (From)',
			'Referrer Content',
			'Count',
			'Link Status Code',
			'Link Status Text',
			'Link Content Type',
		]);
	});

	it('streams one row per edge without lazy thunks', async () => {
		vi.mocked(streamAnchorFactEdges).mockReturnValue(
			oneChunk([
				{
					destUrl: 'https://example.com/target',
					sourceUrl: 'https://example.com/referrer',
					rawDestUrl: 'https://example.com/target',
					textContent: 'Click here',
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					count: 3,
				},
			]),
		);
		const setting = createReferrersRelationalTable([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 999,
			onProgress: () => {},
		});

		expect(mock.rows).toHaveLength(1);
		assertNoLazyCells(mock.rows);
		const row = mock.rows[0]!;
		// Link (To)/Referrer (From) render as HYPERLINK formulas, not plain strings.
		expect(cellValue(row[0]!)).toContain('https://example.com/target');
		expect(cellValue(row[1]!)).toContain('https://example.com/referrer');
		expect(cellValue(row[2]!)).toBe('Click here');
		expect(cellValue(row[3]!)).toBe(3);
		expect(cellValue(row[4]!)).toBe(200);
	});

	it('falls back to a placeholder when there is no anchor text', async () => {
		vi.mocked(streamAnchorFactEdges).mockReturnValue(
			oneChunk([
				{
					destUrl: 'https://example.com/target',
					sourceUrl: 'https://example.com/referrer',
					rawDestUrl: 'https://example.com/target',
					textContent: null,
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					count: 1,
				},
			]),
		);
		const setting = createReferrersRelationalTable([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 999,
			onProgress: () => {},
		});
		expect(cellValue(mock.rows[0]![2]!)).toBe('__NO_TEXT_CONTENT__');
	});

	it('notes the raw pre-resolution href on "Link (To)" when it differs from the resolved destination', async () => {
		vi.mocked(streamAnchorFactEdges).mockReturnValue(
			oneChunk([
				{
					destUrl: 'https://example.com/target',
					sourceUrl: 'https://example.com/referrer',
					rawDestUrl: 'https://example.com/old',
					textContent: 'Click here',
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					count: 1,
				},
			]),
		);
		const setting = createReferrersRelationalTable([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 999,
			onProgress: () => {},
		});
		expect(cellNote(mock.rows[0]![0]!)).toBe('Redirected from: https://example.com/old');
	});

	it('leaves "Link (To)" without a note when the raw href already matches the resolved destination', async () => {
		vi.mocked(streamAnchorFactEdges).mockReturnValue(
			oneChunk([
				{
					destUrl: 'https://example.com/target',
					sourceUrl: 'https://example.com/referrer',
					rawDestUrl: 'https://example.com/target',
					textContent: 'Click here',
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					count: 1,
				},
			]),
		);
		const setting = createReferrersRelationalTable([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 999,
			onProgress: () => {},
		});
		expect(cellNote(mock.rows[0]![0]!)).toBeUndefined();
	});

	it('stops sending rows once maxRows is reached', async () => {
		vi.mocked(streamAnchorFactEdges).mockReturnValue(
			oneChunk(
				Array.from({ length: 3 }, () => ({
					destUrl: 'https://example.com/target',
					sourceUrl: 'https://example.com/referrer',
					rawDestUrl: 'https://example.com/target',
					textContent: 'text',
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					count: 1,
				})),
			),
		);
		const setting = createReferrersRelationalTable([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: 1,
			estimatedTotal: 3,
			onProgress: () => {},
		});
		expect(mock.rows).toHaveLength(1);
		expect(mock.flushCount).toBe(1);
	});

	it('reports onProgress against ctx.estimatedTotal, not maxRows (issue: misleading progress denominator)', async () => {
		vi.mocked(streamAnchorFactEdges).mockReturnValue(
			oneChunk([
				{
					destUrl: 'https://example.com/target',
					sourceUrl: 'https://example.com/referrer',
					rawDestUrl: 'https://example.com/target',
					textContent: 'text',
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					count: 1,
				},
			]),
		);
		const setting = createReferrersRelationalTable([], NO_ACCESSOR);
		const mock = createMockSheet();
		const onProgress = vi.fn();
		await setting.run({
			sheet: mock.sheet,
			maxRows: 1_000_000, // far larger than estimatedTotal — must not leak into `total`
			estimatedTotal: 1,
			onProgress,
		});
		expect(onProgress).toHaveBeenCalledWith(1, 1);
	});
});
