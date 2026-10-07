import { describe, expect, it } from 'vitest';

import { escapeRegExpSource } from './escape-regexp-source.js';

describe('escapeRegExpSource', () => {
	it.each(['a.b', '(x)', '[y]', '{1}', 'a|b', 'a*b+c?', '^$', String.raw`a\b`])(
		'matches %j literally',
		(text) => {
			expect(new RegExp(`^${escapeRegExpSource(text)}$`).test(text)).toBe(true);
		},
	);

	it('does not let a metacharacter match another character', () => {
		expect(new RegExp(`^${escapeRegExpSource('a.b')}$`).test('axb')).toBe(false);
	});

	it('leaves plain text alone', () => {
		expect(escapeRegExpSource('abc-123')).toBe('abc-123');
	});
});
