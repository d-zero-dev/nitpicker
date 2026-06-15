import { describe, expect, it } from 'vitest';

import { computeRatio } from './compute-ratio.js';

describe('computeRatio', () => {
	it('returns 0 when total is zero (the empty-archive case)', () => {
		expect(computeRatio(0, 0)).toBe(0);
	});

	it('returns 0 when total is zero even if count is non-zero (defensive)', () => {
		/* Should never happen — count being non-zero while total is zero
		   violates the invariant that total is the sum of counts — but if
		   it ever did, returning 0 keeps the bar empty rather than
		   producing Infinity. */
		expect(computeRatio(5, 0)).toBe(0);
	});

	it('returns the proportional share for typical inputs', () => {
		expect(computeRatio(50, 200)).toBe(0.25);
	});

	it('returns 1 when count equals total', () => {
		expect(computeRatio(7, 7)).toBe(1);
	});

	it('returns 0 when count is 0 and total is positive', () => {
		expect(computeRatio(0, 100)).toBe(0);
	});

	it('returns a negative ratio when count is negative (loud signal of upstream bug)', () => {
		expect(computeRatio(-1, 10)).toBe(-0.1);
	});
});
