import { getInboundReferrerUrlsByPageIds, streamAllContentItems } from '@nitpicker/query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { assertNoLazyCells } from '../test-helpers/assert-no-lazy-cells.js';
import { cellNote, cellValue } from '../test-helpers/cell-inspection.js';
import { createMockSheet } from '../test-helpers/create-mock-sheet.js';
import { oneChunk } from '../test-helpers/one-chunk.js';

import { createLinks } from './create-links.js';

vi.mock('@nitpicker/query', () => ({
	streamAllContentItems: vi.fn(),
	getInboundReferrerUrlsByPageIds: vi.fn(),
}));

const NO_ACCESSOR = undefined as never;

describe('createLinks', () => {
	beforeEach(() => {
		vi.mocked(streamAllContentItems).mockReset();
		vi.mocked(getInboundReferrerUrlsByPageIds).mockReset();
		vi.mocked(getInboundReferrerUrlsByPageIds).mockResolvedValue(new Map());
	});

	it('returns sheet config with name "Links" and requiresReadModel', () => {
		const setting = createLinks([], NO_ACCESSOR);
		expect(setting.name).toBe('Links');
		expect(setting.requiresReadModel).toBe(true);
	});

	it('returns correct headers', () => {
		const setting = createLinks([], NO_ACCESSOR);
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

		const setting = createLinks([], NO_ACCESSOR);
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

		const setting = createLinks([], NO_ACCESSOR);
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
			new Map([[1, ['https://example.com/a', 'https://example.com/b']]]),
		);

		const setting = createLinks([], NO_ACCESSOR);
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
		const setting = createLinks([], NO_ACCESSOR);
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
		const setting = createLinks([], NO_ACCESSOR);
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
