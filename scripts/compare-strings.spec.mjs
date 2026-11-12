import { describe, it, expect } from 'vitest';

import { compareStrings } from './compare-strings.mjs';

describe('compareStrings', () => {
	it('returns a negative number when the first string sorts first', () => {
		expect(compareStrings('a', 'b')).toBe(-1);
	});

	it('returns a positive number when the second string sorts first', () => {
		expect(compareStrings('b', 'a')).toBe(1);
	});

	it('returns 0 for equal strings', () => {
		expect(compareStrings('a', 'a')).toBe(0);
		expect(compareStrings('', '')).toBe(0);
	});

	it('orders by UTF-16 code unit, so upper case sorts before lower case', () => {
		expect(compareStrings('Z', 'a')).toBe(-1);
		expect(compareStrings('a', 'Z')).toBe(1);
	});

	it('compares digit strings character by character, not numerically', () => {
		expect(compareStrings('10', '9')).toBe(-1);
	});

	it('sorts a prefix before the longer string', () => {
		expect(compareStrings('ab', 'abc')).toBe(-1);
	});

	it('orders non-ASCII characters by code unit', () => {
		expect(compareStrings('z', 'あ')).toBe(-1);
		expect(compareStrings('あ', 'z')).toBe(1);
	});

	it('matches the default sort order when used with toSorted', () => {
		const values = ['b', 'B', '10', '9', 'あ', 'a', 'Z', ''];
		expect(values.toSorted(compareStrings)).toEqual(values.toSorted());
	});
});
