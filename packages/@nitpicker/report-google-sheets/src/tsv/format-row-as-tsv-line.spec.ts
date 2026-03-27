import { createCellData } from '@d-zero/google-sheets';
import { describe, it, expect } from 'vitest';

import { defaultCellFormat } from '../sheets/default-cell-format.js';

import { formatRowAsTsvLine } from './format-row-as-tsv-line.js';

describe('formatRowAsTsvLine', () => {
	it('joins plain fields with tabs', () => {
		const row = [
			createCellData({ value: 'a' }, defaultCellFormat),
			createCellData({ value: 'b' }, defaultCellFormat),
		];
		expect(formatRowAsTsvLine(row)).toBe('a\tb');
	});

	it('quotes fields that contain double quotes and escapes them', () => {
		const row = [createCellData({ value: 'say "hi"' }, defaultCellFormat)];
		expect(formatRowAsTsvLine(row)).toBe('"say ""hi"""');
	});
});
