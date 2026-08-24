import { streamResourceReferrerEdges } from '@nitpicker/query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { assertNoLazyCells } from '../test-helpers/assert-no-lazy-cells.js';
import { cellValue } from '../test-helpers/cell-inspection.js';
import { createMockSheet } from '../test-helpers/create-mock-sheet.js';
import { oneChunk } from '../test-helpers/one-chunk.js';

import { createResourcesRelationalTable } from './create-resources-relational-table.js';

vi.mock('@nitpicker/query', () => ({
	streamResourceReferrerEdges: vi.fn(),
}));

const NO_ACCESSOR = { getKnex: () => ({}) } as never;

describe('createResourcesRelationalTable', () => {
	beforeEach(() => {
		vi.mocked(streamResourceReferrerEdges).mockReset();
	});

	it('returns sheet config with name "Resources Relational Table", no read-model dependency', () => {
		const setting = createResourcesRelationalTable([], NO_ACCESSOR);
		expect(setting.name).toBe('Resources Relational Table');
		expect(setting.requiresReadModel).toBeFalsy();
	});

	it('returns correct headers', () => {
		const setting = createResourcesRelationalTable([], NO_ACCESSOR);
		expect(setting.createHeaders()).toEqual([
			'Referred Page (From)',
			'Resource (To)',
			'Resource Status Code',
			'Resource Status Text',
			'Resource Content Type',
			'Resource Size',
		]);
	});

	it('streams one row per (resource, page) edge without lazy thunks', async () => {
		vi.mocked(streamResourceReferrerEdges).mockReturnValue(
			oneChunk([
				{
					pageUrl: 'https://example.com/page',
					resourceUrl: 'https://example.com/style.css',
					status: 200,
					statusText: 'OK',
					contentType: 'text/css',
					contentLength: 1000,
				},
			]),
		);
		const setting = createResourcesRelationalTable([], NO_ACCESSOR);
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
		expect(cellValue(row[0]!)).toContain('https://example.com/page');
		expect(cellValue(row[1]!)).toBe('https://example.com/style.css');
		expect(cellValue(row[2]!)).toBe(200);
		expect(cellValue(row[5]!)).toBe(1000);
	});

	it('stops sending rows once maxRows is reached', async () => {
		vi.mocked(streamResourceReferrerEdges).mockReturnValue(
			oneChunk(
				Array.from({ length: 3 }, () => ({
					pageUrl: 'https://example.com/page',
					resourceUrl: 'https://example.com/style.css',
					status: 200,
					statusText: 'OK',
					contentType: 'text/css',
					contentLength: 1000,
				})),
			),
		);
		const setting = createResourcesRelationalTable([], NO_ACCESSOR);
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
		vi.mocked(streamResourceReferrerEdges).mockReturnValue(
			oneChunk([
				{
					pageUrl: 'https://example.com/page',
					resourceUrl: 'https://example.com/style.css',
					status: 200,
					statusText: 'OK',
					contentType: 'text/css',
					contentLength: 1000,
				},
			]),
		);
		const setting = createResourcesRelationalTable([], NO_ACCESSOR);
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
