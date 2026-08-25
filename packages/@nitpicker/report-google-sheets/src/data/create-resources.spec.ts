import type { ResourceGroupStreamRow, ResourceStreamRow } from '@nitpicker/query';

import {
	getResourceReferrerUrlsByResourceIds,
	streamAllResourcesRaw,
	streamResourceGroups,
} from '@nitpicker/query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { assertNoLazyCells } from '../test-helpers/assert-no-lazy-cells.js';
import { cellValue, cellNote } from '../test-helpers/cell-inspection.js';
import { createMockSheet } from '../test-helpers/create-mock-sheet.js';
import { oneChunk } from '../test-helpers/one-chunk.js';

import { createResources, formatContentLength } from './create-resources.js';

vi.mock('@nitpicker/query', () => ({
	streamAllResourcesRaw: vi.fn(),
	getResourceReferrerUrlsByResourceIds: vi.fn(),
	streamResourceGroups: vi.fn(),
}));

/**
 * Builds a {@link ResourceStreamRow} fixture for tests, with sensible
 * defaults overridable per field.
 * @param overrides - Fields to override on the default row.
 */
function makeRow(overrides: Partial<ResourceStreamRow> = {}): ResourceStreamRow {
	return {
		resourceId: 1,
		url: 'https://example.com/style.css',
		status: 200,
		statusText: 'OK',
		contentType: 'text/css',
		contentLength: 1000,
		referrerCount: 1,
		...overrides,
	};
}

/**
 * Builds a {@link ResourceGroupStreamRow} fixture for tests, with sensible
 * defaults overridable per field.
 * @param overrides - Fields to override on the default row.
 */
function makeGroup(
	overrides: Partial<ResourceGroupStreamRow> = {},
): ResourceGroupStreamRow {
	return {
		canonicalUrl: 'https://example.com/pixel?id',
		status: 200,
		statusText: 'OK',
		contentType: 'application/javascript',
		contentLengthMin: 100,
		contentLengthMax: 100,
		count: 1,
		referrerCount: 1,
		referrerNote: 'https://example.com/',
		queryPattern: 'id=1',
		...overrides,
	};
}

/**
 * Builds a fake accessor whose `getKnex()().count()` resolves to a fixed
 * row count, for `estimateRowCount()` tests.
 * @param count - The `COUNT(*)` value to return.
 */
function makeAccessor(count: number) {
	return {
		getKnex: () => () => ({
			count: () => [{ count }],
		}),
	} as never;
}

describe('formatContentLength', () => {
	it('returns null when nothing was recorded', () => {
		expect(
			formatContentLength({ contentLengthMin: null, contentLengthMax: null }),
		).toBeNull();
	});

	it('returns a single number when every observation matched', () => {
		expect(formatContentLength({ contentLengthMin: 500, contentLengthMax: 500 })).toBe(
			500,
		);
	});

	it('returns a "min-max" string when sizes vary', () => {
		expect(formatContentLength({ contentLengthMin: 100, contentLengthMax: 900 })).toBe(
			'100-900',
		);
	});
});

describe('createResources (raw mode)', () => {
	beforeEach(() => {
		vi.mocked(streamAllResourcesRaw).mockReset();
		vi.mocked(getResourceReferrerUrlsByResourceIds).mockReset();
		vi.mocked(getResourceReferrerUrlsByResourceIds).mockResolvedValue(new Map());
	});

	it('returns sheet config with name "Resources" and the raw headers', () => {
		const setting = createResources()([], makeAccessor(0));
		expect(setting.name).toBe('Resources');
		expect(setting.requiresReadModel).toBeFalsy();
		expect(setting.createHeaders()).toEqual([
			'URL',
			'Status Code',
			'Status Text',
			'Content Type',
			'Content Length',
			'Referrers',
		]);
	});

	it('estimates the row count via a resource_items COUNT(*)', async () => {
		const setting = createResources()([], makeAccessor(42));
		await expect(setting.estimateRowCount()).resolves.toBe(42);
	});

	it('streams one row per resource without lazy thunks', async () => {
		vi.mocked(streamAllResourcesRaw).mockReturnValue(oneChunk([makeRow()]));
		vi.mocked(getResourceReferrerUrlsByResourceIds).mockResolvedValue(
			new Map([[1, ['https://example.com/a', 'https://example.com/b']]]),
		);

		const setting = createResources()([], makeAccessor(1));
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
		expect(cellValue(row[0]!)).toBe('https://example.com/style.css');
		expect(cellValue(row[4]!)).toBe(1000);
		expect(cellValue(row[5]!)).toBe('2 pages');
		expect(cellNote(row[5]!)).toContain('https://example.com/a');
	});

	it('reports onProgress against ctx.estimatedTotal, not maxRows (issue: misleading progress denominator)', async () => {
		vi.mocked(streamAllResourcesRaw).mockReturnValue(oneChunk([makeRow()]));
		const setting = createResources()([], makeAccessor(1));
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

	it('stops sending rows once maxRows is reached', async () => {
		vi.mocked(streamAllResourcesRaw).mockReturnValue(
			oneChunk([
				makeRow({ resourceId: 1 }),
				makeRow({ resourceId: 2 }),
				makeRow({ resourceId: 3 }),
			]),
		);
		const setting = createResources()([], makeAccessor(3));
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
});

describe('createResources (dedupe mode)', () => {
	beforeEach(() => {
		vi.mocked(streamResourceGroups).mockReset();
	});

	it('returns sheet config with requiresReadModel and the dedupe headers, including Count and Query Pattern', () => {
		const setting = createResources({ dedupe: true })([], makeAccessor(0));
		expect(setting.name).toBe('Resources');
		expect(setting.requiresReadModel).toBe(true);
		expect(setting.createHeaders()).toEqual([
			'URL',
			'Status Code',
			'Status Text',
			'Content Type',
			'Content Length',
			'Referrers',
			'Count',
			'Query Pattern',
		]);
	});

	it('estimates the row count via a viewer_resource_groups COUNT(*)', async () => {
		const setting = createResources({ dedupe: true })([], makeAccessor(7));
		await expect(setting.estimateRowCount()).resolves.toBe(7);
	});

	it('streams precomputed groups without any per-row aggregation, without lazy thunks', async () => {
		vi.mocked(streamResourceGroups).mockReturnValueOnce(
			oneChunk([
				makeGroup({
					canonicalUrl: 'https://example.com/pixel?id',
					contentLengthMin: 100,
					contentLengthMax: 900,
					count: 2,
					referrerCount: 2,
					referrerNote: 'https://example.com/a\nhttps://example.com/b',
					queryPattern: 'id=2',
				}),
			]),
		);

		const setting = createResources({ dedupe: true })([], makeAccessor(1));
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});

		expect(mock.rows).toHaveLength(1);
		assertNoLazyCells(mock.rows);
		const row = mock.rows[0]!;
		expect(cellValue(row[0]!)).toBe('https://example.com/pixel?id');
		expect(cellValue(row[4]!)).toBe('100-900');
		expect(cellValue(row[5]!)).toBe('2 pages');
		expect(cellNote(row[5]!)).toContain('https://example.com/a');
		expect(cellValue(row[6]!)).toBe(2);
		expect(cellValue(row[7]!)).toBe('id=2');
	});

	it('renders an empty note (not the literal string "null") for a group with no referrers', async () => {
		vi.mocked(streamResourceGroups).mockReturnValueOnce(
			oneChunk([makeGroup({ referrerCount: 0, referrerNote: null })]),
		);

		const setting = createResources({ dedupe: true })([], makeAccessor(1));
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});
		expect(cellNote(mock.rows[0]![5]!)).toBe('');
	});

	it('truncates an extremely long referrer note', async () => {
		vi.mocked(streamResourceGroups).mockReturnValueOnce(
			oneChunk([makeGroup({ referrerNote: 'https://example.com/x\n'.repeat(1000) })]),
		);

		const setting = createResources({ dedupe: true })([], makeAccessor(1));
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});
		const note = cellNote(mock.rows[0]![5]!)!;
		expect(note.length).toBeLessThan(1000 * 'https://example.com/x\n'.length);
		expect(note).toContain('truncated');
	});

	it('stops sending rows once maxRows is reached', async () => {
		vi.mocked(streamResourceGroups).mockReturnValueOnce(
			oneChunk([
				makeGroup({ canonicalUrl: 'https://example.com/a.js' }),
				makeGroup({ canonicalUrl: 'https://example.com/b.js' }),
			]),
		);
		const setting = createResources({ dedupe: true })([], makeAccessor(2));
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: 1,
			estimatedTotal: 2,
			onProgress: () => {},
		});
		expect(mock.rows).toHaveLength(1);
		expect(mock.flushCount).toBe(1);
	});

	it('reports onProgress against ctx.estimatedTotal', async () => {
		vi.mocked(streamResourceGroups).mockReturnValueOnce(oneChunk([makeGroup()]));
		const setting = createResources({ dedupe: true })([], makeAccessor(1));
		const mock = createMockSheet();
		const onProgress = vi.fn();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress,
		});
		expect(onProgress).toHaveBeenCalledWith(1, 1);
	});
});
