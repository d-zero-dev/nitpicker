import { describe, it, expect } from 'vitest';

import { defaultCellFormat } from './default-cell-format.js';

describe('defaultCellFormat', () => {
	it('has OVERFLOW_CELL wrapStrategy', () => {
		expect(defaultCellFormat.wrapStrategy).toBe('OVERFLOW_CELL');
	});

	it('is frozen', () => {
		expect(Object.isFrozen(defaultCellFormat)).toBe(true);
	});
});
