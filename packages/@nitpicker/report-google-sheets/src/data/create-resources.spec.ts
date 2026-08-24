import type { DedupeEntry } from './create-resources.js';
import type { ResourceStreamRow } from '@nitpicker/query';

import {
	getResourceReferrerUrlsByResourceIds,
	streamAllResourcesRaw,
} from '@nitpicker/query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { assertNoLazyCells } from '../test-helpers/assert-no-lazy-cells.js';
import { cellValue, cellNote } from '../test-helpers/cell-inspection.js';
import { createMockSheet } from '../test-helpers/create-mock-sheet.js';
import { oneChunk } from '../test-helpers/one-chunk.js';

import {
	createResources,
	dedupeKey,
	formatContentLength,
	formatQueryPattern,
	MAX_PARAM_VALUE_SAMPLES,
} from './create-resources.js';

vi.mock('@nitpicker/query', () => ({
	streamAllResourcesRaw: vi.fn(),
	getResourceReferrerUrlsByResourceIds: vi.fn(),
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
 * Builds a fake accessor whose `getKnex()().count()` resolves to a fixed
 * `resource_items` row count, for `estimateRowCount()` tests.
 * @param resourceCount - The `COUNT(*)` value to return.
 */
function makeAccessor(resourceCount: number) {
	return {
		getKnex: () => () => ({
			count: () => [{ count: resourceCount }],
		}),
	} as never;
}

/**
 * Builds a minimal {@link DedupeEntry} for the pure-helper tests.
 * @param overrides - Fields to override on the default entry.
 */
function makeEntry(overrides: Partial<DedupeEntry> = {}): DedupeEntry {
	return {
		canonical: 'https://example.com/p',
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLengthMin: null,
		contentLengthMax: null,
		count: 1,
		referrers: new Set(),
		paramValues: new Map(),
		...overrides,
	};
}

describe('dedupeKey', () => {
	it('joins status, contentType, and canonical with a non-printable separator', () => {
		const key = dedupeKey('https://example.com/p', 200, 'text/html');
		expect(key).toBe('200text/htmlhttps://example.com/p');
	});

	it('uses a distinct null marker so null and empty string do not collide', () => {
		const nullKey = dedupeKey('https://example.com/p', null, null);
		const emptyKey = dedupeKey('https://example.com/p', null, '');
		expect(nullKey).not.toBe(emptyKey);
	});
});

describe('formatQueryPattern', () => {
	it('returns null when the entry has no query parameters', () => {
		expect(formatQueryPattern(makeEntry())).toBeNull();
	});

	it('reports the distinct-value count per key, sorted alphabetically', () => {
		const entry = makeEntry({
			paramValues: new Map([
				['b', { values: new Set(['1', '2']), overflowedCount: 0 }],
				['a', { values: new Set(['x']), overflowedCount: 0 }],
			]),
		});
		expect(formatQueryPattern(entry)).toBe('a=1, b=2');
	});

	it('appends "+" only once the sample set has actually overflowed', () => {
		const full = new Set(
			Array.from({ length: MAX_PARAM_VALUE_SAMPLES }, (_, i) => String(i)),
		);
		const entry = makeEntry({
			paramValues: new Map([['id', { values: full, overflowedCount: 1 }]]),
		});
		expect(formatQueryPattern(entry)).toBe(`id=${MAX_PARAM_VALUE_SAMPLES}+`);
	});
});

describe('formatContentLength', () => {
	it('returns null when nothing was recorded', () => {
		expect(formatContentLength(makeEntry())).toBeNull();
	});

	it('returns a single number when every observation matched', () => {
		expect(
			formatContentLength(makeEntry({ contentLengthMin: 500, contentLengthMax: 500 })),
		).toBe(500);
	});

	it('returns a "min-max" string when sizes vary', () => {
		expect(
			formatContentLength(makeEntry({ contentLengthMin: 100, contentLengthMax: 900 })),
		).toBe('100-900');
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
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });

		expect(mock.rows).toHaveLength(1);
		assertNoLazyCells(mock.rows);
		const row = mock.rows[0]!;
		expect(cellValue(row[0]!)).toBe('https://example.com/style.css');
		expect(cellValue(row[4]!)).toBe(1000);
		expect(cellValue(row[5]!)).toBe('2 pages');
		expect(cellNote(row[5]!)).toContain('https://example.com/a');
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
		await setting.run({ sheet: mock.sheet, maxRows: 1, onProgress: () => {} });
		expect(mock.rows).toHaveLength(1);
		expect(mock.flushCount).toBe(1);
	});
});

describe('createResources (dedupe mode)', () => {
	beforeEach(() => {
		vi.mocked(streamAllResourcesRaw).mockReset();
		vi.mocked(getResourceReferrerUrlsByResourceIds).mockReset();
		vi.mocked(getResourceReferrerUrlsByResourceIds).mockResolvedValue(new Map());
	});

	it('returns sheet config with the dedupe headers, including Count and Query Pattern', () => {
		const setting = createResources({ dedupe: true })([], makeAccessor(0));
		expect(setting.name).toBe('Resources');
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

	it('collapses raw resources sharing a canonical URL into one row', async () => {
		vi.mocked(streamAllResourcesRaw).mockReturnValue(
			oneChunk([
				makeRow({
					resourceId: 1,
					url: 'https://example.com/pixel?id=aaa',
					contentLength: 100,
				}),
				makeRow({
					resourceId: 2,
					url: 'https://example.com/pixel?id=bbb',
					contentLength: 900,
				}),
			]),
		);
		vi.mocked(getResourceReferrerUrlsByResourceIds).mockImplementation(
			(_accessor, ids) => {
				const map = new Map<number, string[]>();
				for (const id of ids) {
					map.set(id, [`https://example.com/referrer-${id}`]);
				}
				return Promise.resolve(map);
			},
		);

		const setting = createResources({ dedupe: true })([], makeAccessor(2));
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });

		expect(mock.rows).toHaveLength(1);
		assertNoLazyCells(mock.rows);
		const row = mock.rows[0]!;
		expect(cellValue(row[0]!)).toBe('https://example.com/pixel?id');
		expect(cellValue(row[4]!)).toBe('100-900');
		expect(cellValue(row[5]!)).toBe('2 pages');
		expect(cellValue(row[6]!)).toBe(2);
		expect(cellValue(row[7]!)).toBe('id=2');
	});

	it('does not report "+" overflow when only already-sampled values repeat past the cap', async () => {
		// Exactly MAX_PARAM_VALUE_SAMPLES distinct values, but the first one
		// repeats many more times after the sample set is full. None of
		// those repeats are a genuinely new (lost) value, so the pattern
		// must stay "id=100", not "id=100+".
		const distinctRows = Array.from({ length: MAX_PARAM_VALUE_SAMPLES }, (_, i) =>
			makeRow({ resourceId: i + 1, url: `https://example.com/pixel?id=${i}` }),
		);
		const repeatRows = Array.from({ length: 5 }, (_, i) =>
			makeRow({
				resourceId: MAX_PARAM_VALUE_SAMPLES + i + 1,
				url: 'https://example.com/pixel?id=0',
			}),
		);
		vi.mocked(streamAllResourcesRaw).mockReturnValue(
			oneChunk([...distinctRows, ...repeatRows]),
		);

		const setting = createResources({ dedupe: true })(
			[],
			makeAccessor(distinctRows.length),
		);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });

		expect(mock.rows).toHaveLength(1);
		expect(cellValue(mock.rows[0]![7]!)).toBe(`id=${MAX_PARAM_VALUE_SAMPLES}`);
	});

	it('keeps distinct (canonical, status, contentType) combinations in separate rows', async () => {
		vi.mocked(streamAllResourcesRaw).mockReturnValue(
			oneChunk([
				makeRow({ resourceId: 1, url: 'https://example.com/a.js', status: 200 }),
				makeRow({ resourceId: 2, url: 'https://example.com/a.js', status: 404 }),
			]),
		);

		const setting = createResources({ dedupe: true })([], makeAccessor(2));
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });
		expect(mock.rows).toHaveLength(2);
	});

	it('emits rows sorted by canonical URL, not stream order', async () => {
		vi.mocked(streamAllResourcesRaw).mockReturnValue(
			oneChunk([
				makeRow({ resourceId: 1, url: 'https://example.com/z.js' }),
				makeRow({ resourceId: 2, url: 'https://example.com/a.js' }),
			]),
		);
		const setting = createResources({ dedupe: true })([], makeAccessor(2));
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });
		expect(cellValue(mock.rows[0]![0]!)).toBe('https://example.com/a.js');
		expect(cellValue(mock.rows[1]![0]!)).toBe('https://example.com/z.js');
	});

	it('groups a blob-routed (null url) resource under one degenerate key instead of throwing', async () => {
		vi.mocked(streamAllResourcesRaw).mockReturnValue(
			oneChunk([
				makeRow({ resourceId: 1, url: null }),
				makeRow({ resourceId: 2, url: null }),
			]),
		);
		const setting = createResources({ dedupe: true })([], makeAccessor(2));
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });
		expect(mock.rows).toHaveLength(1);
		expect(cellValue(mock.rows[0]![6]!)).toBe(2);
	});

	it('truncates the sorted output once maxRows is reached', async () => {
		vi.mocked(streamAllResourcesRaw).mockReturnValue(
			oneChunk([
				makeRow({ resourceId: 1, url: 'https://example.com/a.js' }),
				makeRow({ resourceId: 2, url: 'https://example.com/b.js' }),
				makeRow({ resourceId: 3, url: 'https://example.com/c.js' }),
			]),
		);
		const setting = createResources({ dedupe: true })([], makeAccessor(3));
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: 1, onProgress: () => {} });
		expect(mock.rows).toHaveLength(1);
		expect(cellValue(mock.rows[0]![0]!)).toBe('https://example.com/a.js');
	});
});
