import { describe, expect, it } from 'vitest';

import { ordinalToLetters } from './ordinal-to-letters.js';

describe('ordinalToLetters', () => {
	it('maps 1–26 to single letters', () => {
		expect(ordinalToLetters(1)).toBe('A');
		expect(ordinalToLetters(2)).toBe('B');
		expect(ordinalToLetters(26)).toBe('Z');
	});

	it('rolls over to two letters after Z (bijective base-26)', () => {
		expect(ordinalToLetters(27)).toBe('AA');
		expect(ordinalToLetters(28)).toBe('AB');
		expect(ordinalToLetters(52)).toBe('AZ');
		expect(ordinalToLetters(53)).toBe('BA');
		expect(ordinalToLetters(702)).toBe('ZZ');
		expect(ordinalToLetters(703)).toBe('AAA');
	});

	it('rejects zero, negatives and fractions', () => {
		expect(() => ordinalToLetters(0)).toThrow(RangeError);
		expect(() => ordinalToLetters(-3)).toThrow(RangeError);
		expect(() => ordinalToLetters(1.5)).toThrow(RangeError);
	});
});
