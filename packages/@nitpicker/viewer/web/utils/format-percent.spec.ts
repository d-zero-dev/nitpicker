import { describe, expect, it } from 'vitest';

import { formatPercent } from './format-percent.js';

describe('formatPercent', () => {
	it('returns `0%` for an exact zero ratio', () => {
		expect(formatPercent(0)).toBe('0%');
	});

	it('returns `<0.1%` for a non-zero ratio below the display floor', () => {
		expect(formatPercent(0.0004)).toBe('<0.1%');
	});

	it('returns one decimal place for typical ratios', () => {
		expect(formatPercent(0.123)).toBe('12.3%');
	});

	it('returns `100.0%` for a full ratio', () => {
		expect(formatPercent(1)).toBe('100.0%');
	});

	it('clamps ratios above 1 to `100.0%`', () => {
		expect(formatPercent(1.5)).toBe('100.0%');
	});

	it('returns `0%` for negative ratios (clamped, the count can never be negative)', () => {
		expect(formatPercent(-0.1)).toBe('0%');
	});

	it('returns `0%` for NaN (guards against upstream divide-by-zero)', () => {
		expect(formatPercent(Number.NaN)).toBe('0%');
	});

	it('returns `0%` for Infinity', () => {
		expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('0%');
	});

	it('uses one decimal place at the edge of the floor (exactly 0.001)', () => {
		expect(formatPercent(0.001)).toBe('0.1%');
	});

	it('returns `<0.1%` just below the floor (0.0009)', () => {
		expect(formatPercent(0.0009)).toBe('<0.1%');
	});
});
