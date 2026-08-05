import { describe, expect, it } from 'vitest';

import { toFlagValues } from './to-flag-values.js';

describe('toFlagValues', () => {
	it('returns undefined for undefined', () => {
		expect(toFlagValues()).toBeUndefined();
	});

	it('returns undefined for null', () => {
		expect(toFlagValues(null)).toBeUndefined();
	});

	it('maps a scalar true to 1 by default', () => {
		expect(toFlagValues(true)).toBe(1);
	});

	it('maps a scalar false to 0 by default', () => {
		expect(toFlagValues(false)).toBe(0);
	});

	it('maps an array preserving order', () => {
		expect(toFlagValues([true, false, true])).toEqual([1, 0, 1]);
	});

	it('maps an empty array to an empty array', () => {
		expect(toFlagValues([])).toEqual([]);
	});

	it('inverts the mapping via trueValue/falseValue (negated-polarity column)', () => {
		expect(toFlagValues(true, 0, 1)).toBe(0);
		expect(toFlagValues(false, 0, 1)).toBe(1);
		expect(toFlagValues([true, false], 0, 1)).toEqual([0, 1]);
	});
});
