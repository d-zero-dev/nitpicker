import { describe, expect, it } from 'vitest';

import { toCaseInsensitivePattern } from './to-case-insensitive-pattern.js';

describe('toCaseInsensitivePattern', () => {
	it('expands ASCII letters into classes', () => {
		expect(toCaseInsensitivePattern('a-b1')).toBe('[aA]-[bB]1');
	});

	it.each(['foo', 'FOO', 'fOo'])('matches %s', (text) => {
		expect(new RegExp(`^${toCaseInsensitivePattern('foo')}$`).test(text)).toBe(true);
	});

	it('does not fold non-ASCII letters', () => {
		expect(new RegExp(`^${toCaseInsensitivePattern('é')}$`).test('É')).toBe(false);
		expect(new RegExp(`^${toCaseInsensitivePattern('é')}$`).test('é')).toBe(true);
	});

	it('escapes metacharacters', () => {
		expect(new RegExp(`^${toCaseInsensitivePattern('a.b')}$`).test('A.B')).toBe(true);
		expect(new RegExp(`^${toCaseInsensitivePattern('a.b')}$`).test('AxB')).toBe(false);
	});
});
