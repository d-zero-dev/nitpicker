import {
	applyEqualityOrInFilter,
	getInboundReferrerUrlsByPageIds,
	streamAllContentItems,
} from '@nitpicker/query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { assertNoLazyCells } from '../test-helpers/assert-no-lazy-cells.js';
import { cellNote, cellValue } from '../test-helpers/cell-inspection.js';
import { createMockSheet } from '../test-helpers/create-mock-sheet.js';
import { oneChunk } from '../test-helpers/one-chunk.js';

import { createLinks } from './create-links.js';

vi.mock('@nitpicker/query', () => ({
	streamAllContentItems: vi.fn(),
	getInboundReferrerUrlsByPageIds: vi.fn(),
	applyEqualityOrInFilter: vi.fn(),
}));

const NO_ACCESSOR = undefined as never;

/**
 * Builds a fake accessor whose `getKnex()('content_items as ci').join(...).modify(...).count()`
 * chain resolves to a fixed row count, for `estimateRowCount()` tests.
 * @param count - The `COUNT(*)` value to return.
 */
function makeAccessor(count: number) {
	const qb: {
		join: () => unknown;
		modify: (fn: (qb: unknown) => void) => unknown;
		count: () => Promise<{ count: number }[]>;
	} = {
		join: () => qb,
		modify: (fn: (qb: unknown) => void) => {
			fn(qb);
			return qb;
		},
		count: () => Promise.resolve([{ count }]),
	};
	return { getKnex: () => () => qb } as never;
}

describe('createLinks', () => {
	beforeEach(() => {
		vi.mocked(streamAllContentItems).mockReset();
		vi.mocked(getInboundReferrerUrlsByPageIds).mockReset();
		vi.mocked(getInboundReferrerUrlsByPageIds).mockResolvedValue(new Map());
		vi.mocked(applyEqualityOrInFilter).mockReset();
	});

	it('returns sheet config with name "Links" and requiresReadModel', () => {
		const setting = createLinks()([], NO_ACCESSOR);
		expect(setting.name).toBe('Links');
		expect(setting.requiresReadModel).toBe(true);
	});

	it('returns correct headers', () => {
		const setting = createLinks()([], NO_ACCESSOR);
		expect(setting.createHeaders()).toEqual([
			'URL',
			'Page Title',
			'Status Code',
			'Status Text',
			'Content Type',
			'Redirect From',
			'Referrers',
			'Headers',
			'Remarks',
		]);
	});

	it('streams rows without lazy thunks and includes skipped pages', async () => {
		vi.mocked(streamAllContentItems).mockReturnValue(
			oneChunk([
				{
					pageId: 1,
					url: 'https://example.com/page',
					title: 'Page',
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					isSkipped: false,
					skipReason: null,
					responseHeaders: {},
					redirectFromUrls: [],
				},
				{
					pageId: 2,
					url: 'https://example.com/blocked',
					title: null,
					status: null,
					statusText: null,
					contentType: null,
					isSkipped: true,
					skipReason: 'excluded',
					responseHeaders: {},
					redirectFromUrls: [],
				},
			]),
		);

		const setting = createLinks()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 999,
			onProgress: () => {},
		});

		expect(mock.rows).toHaveLength(2);
		assertNoLazyCells(mock.rows);
		expect(cellValue(mock.rows[1]![8]!)).toBe('excluded');
	});

	it('truncates the Headers note when responseHeaders serializes to an extremely long string', async () => {
		vi.mocked(streamAllContentItems).mockReturnValue(
			oneChunk([
				{
					pageId: 1,
					url: 'https://example.com/page',
					title: 'Page',
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					isSkipped: false,
					skipReason: null,
					responseHeaders: { 'set-cookie': 'x'.repeat(10_000) },
					redirectFromUrls: [],
				},
			]),
		);

		const setting = createLinks()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 1,
			onProgress: () => {},
		});

		const note = cellNote(mock.rows[0]![7]!)!;
		expect(note.length).toBeLessThan(10_000);
		expect(note).toContain('truncated');
	});

	it('shows the referrer count and redirect-from count in their respective columns', async () => {
		vi.mocked(streamAllContentItems).mockReturnValue(
			oneChunk([
				{
					pageId: 1,
					url: 'https://example.com/target',
					title: 'Target',
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					isSkipped: false,
					skipReason: null,
					responseHeaders: {},
					redirectFromUrls: ['https://example.com/old'],
				},
			]),
		);
		vi.mocked(getInboundReferrerUrlsByPageIds).mockResolvedValue(
			new Map([
				[
					1,
					[
						{
							url: 'https://example.com/a',
							textContent: 'Link A',
							count: 1,
							redirectedFromUrl: null,
						},
						{
							url: 'https://example.com/b',
							textContent: 'Link B',
							count: 1,
							redirectedFromUrl: null,
						},
					],
				],
			]),
		);

		const setting = createLinks()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 999,
			onProgress: () => {},
		});

		const row = mock.rows[0]!;
		expect(cellValue(row[5]!)).toBe(1); // Redirect From count
		expect(cellValue(row[6]!)).toBe('2 Elements'); // Referrers
	});

	it('sums per-referrer occurrence counts (not distinct referrer count) into the Elements value', async () => {
		vi.mocked(streamAllContentItems).mockReturnValue(
			oneChunk([
				{
					pageId: 1,
					url: 'https://example.com/target',
					title: 'Target',
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					isSkipped: false,
					skipReason: null,
					responseHeaders: {},
					redirectFromUrls: [],
				},
			]),
		);
		vi.mocked(getInboundReferrerUrlsByPageIds).mockResolvedValue(
			new Map([
				[
					1,
					[
						// One referring page, but 3 anchors from it to this
						// destination — the pre-fix code counted this as
						// "1 Elements" (referrer array length); the correct
						// count is the summed occurrence tally.
						{
							url: 'https://example.com/a',
							textContent: 'Link A',
							count: 3,
							redirectedFromUrl: null,
						},
					],
				],
			]),
		);

		const setting = createLinks()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 999,
			onProgress: () => {},
		});

		expect(cellValue(mock.rows[0]![6]!)).toBe('3 Elements');
	});

	it('marks a redirected referrer in the note as "[REDIRECTED FROM] ..."', async () => {
		vi.mocked(streamAllContentItems).mockReturnValue(
			oneChunk([
				{
					pageId: 1,
					url: 'https://example.com/target',
					title: 'Target',
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					isSkipped: false,
					skipReason: null,
					responseHeaders: {},
					redirectFromUrls: [],
				},
			]),
		);
		vi.mocked(getInboundReferrerUrlsByPageIds).mockResolvedValue(
			new Map([
				[
					1,
					[
						{
							url: 'https://example.com/referrer-c',
							textContent: 'To old target',
							count: 1,
							redirectedFromUrl: 'https://example.com/old-target',
						},
					],
				],
			]),
		);

		const setting = createLinks()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 999,
			onProgress: () => {},
		});

		const note = cellNote(mock.rows[0]![6]!)!;
		expect(note).toBe(
			'To old target (https://example.com/referrer-c => [REDIRECTED FROM] https://example.com/old-target)',
		);
	});

	it('stops sending rows once maxRows is reached', async () => {
		vi.mocked(streamAllContentItems).mockReturnValue(
			oneChunk(
				Array.from({ length: 5 }, (_, i) => ({
					pageId: i + 1,
					url: `https://example.com/${i}`,
					title: 'Page',
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					isSkipped: false,
					skipReason: null,
					responseHeaders: {},
					redirectFromUrls: [],
				})),
			),
		);
		const setting = createLinks()([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: 2,
			estimatedTotal: 5,
			onProgress: () => {},
		});
		expect(mock.rows).toHaveLength(2);
		expect(mock.flushCount).toBe(1);
	});

	it('forwards options.urls to applyEqualityOrInFilter on ur.url and to streamAllContentItems', async () => {
		const accessor = makeAccessor(3);
		vi.mocked(streamAllContentItems).mockReturnValueOnce(oneChunk([]));
		const urls = ['https://example.com/a'];
		const setting = createLinks({ urls })([], accessor);

		await expect(setting.estimateRowCount()).resolves.toBe(3);
		expect(applyEqualityOrInFilter).toHaveBeenCalledWith(
			expect.anything(),
			'ur.url',
			urls,
		);

		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 0,
			onProgress: () => {},
		});
		expect(streamAllContentItems).toHaveBeenCalledWith(accessor, { urls });
	});

	it('reports onProgress against ctx.estimatedTotal, not maxRows (issue: misleading progress denominator)', async () => {
		vi.mocked(streamAllContentItems).mockReturnValue(
			oneChunk([
				{
					pageId: 1,
					url: 'https://example.com/page',
					title: 'Page',
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					isSkipped: false,
					skipReason: null,
					responseHeaders: {},
					redirectFromUrls: [],
				},
			]),
		);
		const setting = createLinks()([], NO_ACCESSOR);
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
