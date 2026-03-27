import { createCellData } from '@d-zero/google-sheets';
import { describe, it, expect } from 'vitest';

import { defaultCellFormat } from '../sheets/default-cell-format.js';

import { cellToPlainString } from './cell-to-plain-string.js';

describe('cellToPlainString', () => {
	it('returns string values', () => {
		const cell = createCellData({ value: 'hello' }, defaultCellFormat);
		expect(cellToPlainString(cell)).toBe('hello');
	});

	it('returns number values as decimal strings', () => {
		const cell = createCellData({ value: 42.5 }, defaultCellFormat);
		expect(cellToPlainString(cell)).toBe('42.5');
	});

	it('returns TRUE and FALSE for booleans', () => {
		expect(cellToPlainString(createCellData({ value: true }, defaultCellFormat))).toBe(
			'TRUE',
		);
		expect(cellToPlainString(createCellData({ value: false }, defaultCellFormat))).toBe(
			'FALSE',
		);
	});

	it('returns formula text for leading equals', () => {
		const cell = createCellData({ value: '=1+1' }, defaultCellFormat);
		expect(cellToPlainString(cell)).toBe('=1+1');
	});
});
