import { listViewerImages } from '@nitpicker/query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { assertNoLazyCells } from '../test-helpers/assert-no-lazy-cells.js';
import { cellValue } from '../test-helpers/cell-inspection.js';
import { createMockSheet } from '../test-helpers/create-mock-sheet.js';

import { createImageList } from './create-image-list.js';

vi.mock('@nitpicker/query', () => ({
	listViewerImages: vi.fn(),
}));

const NO_ACCESSOR = undefined as never;

describe('createImageList', () => {
	beforeEach(() => {
		vi.mocked(listViewerImages).mockReset();
	});

	it('returns sheet config with name "Images" and requiresReadModel', () => {
		const setting = createImageList([], NO_ACCESSOR);
		expect(setting.name).toBe('Images');
		expect(setting.requiresReadModel).toBe(true);
	});

	it('returns correct headers, with DOM Path replacing Source Code', () => {
		const setting = createImageList([], NO_ACCESSOR);
		expect(setting.createHeaders()).toEqual([
			'Page URL',
			'Image path (src)',
			'Image Path (currentSrc)',
			'Alternative Text',
			'Displayed Width',
			'Displayed Height',
			'Lazy Loading',
			'DOM Path',
		]);
	});

	it('estimates the row count via listViewerImages(limit: 0)', async () => {
		vi.mocked(listViewerImages).mockResolvedValue({
			items: [],
			total: 7,
			limit: 0,
			offset: 0,
			nextCursor: null,
			prevCursor: null,
		});
		const setting = createImageList([], NO_ACCESSOR);
		await expect(setting.estimateRowCount()).resolves.toBe(7);
	});

	it('streams rows across cursor pages without lazy thunks', async () => {
		vi.mocked(listViewerImages)
			.mockResolvedValueOnce({
				items: [
					{
						pageUrl: 'https://example.com/',
						src: 'https://example.com/a.png',
						currentSrc: 'https://example.com/a.png',
						alt: 'A',
						width: 100,
						height: 50,
						naturalWidth: 100,
						naturalHeight: 50,
						isLazy: true,
						domPath: 'html/body[1]/img[1]',
					},
				],
				total: 2,
				limit: 1,
				offset: 0,
				nextCursor: 'next',
				prevCursor: null,
			})
			.mockResolvedValueOnce({
				items: [
					{
						pageUrl: 'https://example.com/about',
						src: 'https://example.com/b.png',
						currentSrc: null,
						alt: null,
						width: 10,
						height: 10,
						naturalWidth: 10,
						naturalHeight: 10,
						isLazy: false,
						domPath: null,
					},
				],
				total: 2,
				limit: 1,
				offset: 1,
				nextCursor: null,
				prevCursor: 'prev',
			});

		const setting = createImageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: Infinity, onProgress: () => {} });

		expect(mock.rows).toHaveLength(2);
		assertNoLazyCells(mock.rows);
		const row = mock.rows[0]!;
		expect(cellValue(row[0]!)).toBe('https://example.com/');
		expect(cellValue(row[1]!)).toBe('https://example.com/a.png');
		expect(cellValue(row[6]!)).toBe(true);
		expect(cellValue(row[7]!)).toBe('html/body[1]/img[1]');
	});

	it('stops sending rows once maxRows is reached, without following nextCursor', async () => {
		vi.mocked(listViewerImages).mockResolvedValueOnce({
			items: [
				{
					pageUrl: 'https://example.com/',
					src: 'https://example.com/a.png',
					currentSrc: null,
					alt: null,
					width: 1,
					height: 1,
					naturalWidth: 1,
					naturalHeight: 1,
					isLazy: false,
					domPath: 'html/body[1]/img[1]',
				},
				{
					pageUrl: 'https://example.com/',
					src: 'https://example.com/b.png',
					currentSrc: null,
					alt: null,
					width: 1,
					height: 1,
					naturalWidth: 1,
					naturalHeight: 1,
					isLazy: false,
					domPath: 'html/body[1]/img[2]',
				},
			],
			total: 2,
			limit: 2,
			offset: 0,
			nextCursor: 'next',
			prevCursor: null,
		});

		const setting = createImageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({ sheet: mock.sheet, maxRows: 1, onProgress: () => {} });
		expect(mock.rows).toHaveLength(1);
		expect(listViewerImages).toHaveBeenCalledTimes(1);
		expect(mock.flushCount).toBe(1);
	});
});
