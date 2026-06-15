import { describe, expect, it } from 'vitest';

import { clampRatio } from './clamp-ratio.js';

describe('clampRatio', () => {
	it('returns the input verbatim when it is already in range', () => {
		expect(clampRatio(0.5)).toBe(0.5);
	});

	it('returns 0 for negative inputs', () => {
		expect(clampRatio(-0.1)).toBe(0);
	});

	it('returns 1 for inputs above 1', () => {
		expect(clampRatio(1.5)).toBe(1);
	});

	it('returns 0 at the lower edge', () => {
		expect(clampRatio(0)).toBe(0);
	});

	it('returns 1 at the upper edge', () => {
		expect(clampRatio(1)).toBe(1);
	});

	it('passes NaN through verbatim (so downstream formatPercent can decide)', () => {
		/* `Math.max(0, Math.min(1, NaN))` is NaN. The contract: this
		   helper does not invent a value for NaN. The downstream
		   `formatPercent` turns NaN into '0%' for display. Two helpers,
		   one well-defined behaviour each. */
		expect(Number.isNaN(clampRatio(Number.NaN))).toBe(true);
	});
});
