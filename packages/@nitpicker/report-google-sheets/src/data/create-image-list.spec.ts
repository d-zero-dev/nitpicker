import type { ImageStreamRow } from '@nitpicker/query';

import { streamAllImages } from '@nitpicker/query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { assertNoLazyCells } from '../test-helpers/assert-no-lazy-cells.js';
import { cellValue } from '../test-helpers/cell-inspection.js';
import { createMockSheet } from '../test-helpers/create-mock-sheet.js';
import { oneChunk } from '../test-helpers/one-chunk.js';

import { createImageList } from './create-image-list.js';

vi.mock('@nitpicker/query', () => ({
	streamAllImages: vi.fn(),
}));

const NO_ACCESSOR = undefined as never;

/**
 * Builds an {@link ImageStreamRow} fixture for tests, with sensible
 * defaults overridable per field.
 * @param overrides - Fields to override on the default row.
 */
function makeRow(overrides: Partial<ImageStreamRow> = {}): ImageStreamRow {
	return {
		pageUrl: 'https://example.com/',
		src: 'https://example.com/a.png',
		currentSrc: 'https://example.com/a.png',
		alt: 'A',
		width: 100,
		height: 50,
		isLazy: false,
		domPath: 'html/body[1]/img[1]',
		...overrides,
	};
}

/**
 * Builds a fake accessor whose `getKnex()('image_items').count()` resolves
 * to a fixed row count, for `estimateRowCount()` tests.
 * @param imageCount - The `COUNT(*)` value to return.
 */
function makeAccessor(imageCount: number) {
	return {
		getKnex: () => () => ({
			count: () => [{ count: imageCount }],
		}),
	} as never;
}

describe('createImageList', () => {
	beforeEach(() => {
		vi.mocked(streamAllImages).mockReset();
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

	it('estimates the row count via a plain image_items COUNT(*)', async () => {
		const setting = createImageList([], makeAccessor(7));
		await expect(setting.estimateRowCount()).resolves.toBe(7);
	});

	it('streams rows across chunks without lazy thunks', async () => {
		vi.mocked(streamAllImages).mockReturnValueOnce(
			oneChunk([
				makeRow({
					pageUrl: 'https://example.com/',
					src: 'https://example.com/a.png',
					isLazy: true,
					domPath: 'html/body[1]/img[1]',
				}),
				makeRow({
					pageUrl: 'https://example.com/about',
					src: 'https://example.com/b.png',
					currentSrc: null,
					alt: null,
					isLazy: false,
					domPath: null,
				}),
			]),
		);

		const setting = createImageList([], NO_ACCESSOR);
		const mock = createMockSheet();
		await setting.run({
			sheet: mock.sheet,
			maxRows: Infinity,
			estimatedTotal: 2,
			onProgress: () => {},
		});

		expect(mock.rows).toHaveLength(2);
		assertNoLazyCells(mock.rows);
		const row = mock.rows[0]!;
		expect(cellValue(row[0]!)).toBe('https://example.com/');
		expect(cellValue(row[1]!)).toBe('https://example.com/a.png');
		expect(cellValue(row[6]!)).toBe(true);
		expect(cellValue(row[7]!)).toBe('html/body[1]/img[1]');
	});

	it('stops sending rows once maxRows is reached', async () => {
		vi.mocked(streamAllImages).mockReturnValueOnce(
			oneChunk([
				makeRow({ src: 'https://example.com/a.png' }),
				makeRow({ src: 'https://example.com/b.png' }),
			]),
		);

		const setting = createImageList([], NO_ACCESSOR);
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
});
