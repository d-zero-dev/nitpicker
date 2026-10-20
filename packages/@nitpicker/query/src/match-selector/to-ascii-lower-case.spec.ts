import { describe, expect, it } from 'vitest';

import { toAsciiLowerCase } from './to-ascii-lower-case.js';

describe('toAsciiLowerCase', () => {
	it('lower-cases ASCII letters', () => {
		expect(toAsciiLowerCase('DIV-Name_1')).toBe('div-name_1');
	});

	it('leaves non-ASCII letters as they are, including those toLowerCase maps to ASCII', () => {
		expect(toAsciiLowerCase('LINK')).toBe('linK');
		expect(toAsciiLowerCase('İX')).toBe('İx');
		expect(toAsciiLowerCase('É')).toBe('É');
	});

	it('returns an empty string for an empty string', () => {
		expect(toAsciiLowerCase('')).toBe('');
	});
});
