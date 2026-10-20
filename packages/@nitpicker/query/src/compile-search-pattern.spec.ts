import { describe, it, expect } from 'vitest';

import { compileSearchPattern } from './compile-search-pattern.js';

describe('compileSearchPattern', () => {
	it('takes a plain string as a literal', () => {
		expect(compileSearchPattern('fonts.example.org')).toEqual({
			source: 'fonts.example.org',
			literal: true,
			ignoreCase: false,
			multiLine: false,
			dotAll: false,
		});
	});

	it('takes /source/flags as a regular expression', () => {
		expect(compileSearchPattern(String.raw`/UA-\d+-\d+/i`)).toEqual({
			source: String.raw`UA-\d+-\d+`,
			literal: false,
			ignoreCase: true,
			multiLine: false,
			dotAll: false,
		});
	});

	it.each([
		{ flags: 'i', ignoreCase: true, multiLine: false, dotAll: false },
		{ flags: 'm', ignoreCase: false, multiLine: true, dotAll: false },
		{ flags: 's', ignoreCase: false, multiLine: false, dotAll: true },
		// cspell:disable-next-line
		{ flags: 'gimsu', ignoreCase: true, multiLine: true, dotAll: true },
		{ flags: 'gg', ignoreCase: false, multiLine: false, dotAll: false },
	])('reads the flags "$flags"', ({ flags, ...expected }) => {
		expect(compileSearchPattern(`/a/${flags}`)).toMatchObject({
			literal: false,
			...expected,
		});
	});

	it.each(['d', 'v', 'y', 'gy'])('rejects the flag "%s" with a SyntaxError', (flags) => {
		expect(() => compileSearchPattern(`/a/${flags}`)).toThrow(SyntaxError);
		expect(() => compileSearchPattern(`/a/${flags}`)).toThrow(/Invalid flag/);
	});

	it('keeps a string with an unknown trailing letter as a literal', () => {
		expect(compileSearchPattern('/assets/js/x')).toMatchObject({
			source: '/assets/js/x',
			literal: true,
		});
	});

	it('splits at the last slash, so the source may contain slashes', () => {
		expect(compileSearchPattern('/a/b/i')).toMatchObject({
			source: 'a/b',
			ignoreCase: true,
		});
	});

	it('rejects an invalid regular expression with a SyntaxError that names the cause', () => {
		expect(() => compileSearchPattern('/(/')).toThrow(SyntaxError);
		expect(() => compileSearchPattern('/(/')).toThrow(/unclosed group/);
	});

	it.each([String.raw`/(a)\1/`, '/(?=a)a/', '/(?!a)a/', '/(?<=a)a/', '/(?<!a)a/'])(
		'rejects the unsupported construct %s with a SyntaxError',
		(pattern) => {
			expect(() => compileSearchPattern(pattern)).toThrow(SyntaxError);
		},
	);

	it('rejects a pattern that matches the empty string', () => {
		expect(() => compileSearchPattern('/x*/')).toThrow(/must not match the empty string/);
		expect(() => compileSearchPattern('//')).toThrow(/must not match the empty string/);
	});

	it('accepts a pattern that matches empty only inside a document', () => {
		expect(() => compileSearchPattern(String.raw`/\b/`)).not.toThrow();
	});

	it('rejects a pattern that compiles to more than the engine allows with a SyntaxError', () => {
		expect(() => compileSearchPattern(String.raw`/\w{1000}{1000}/`)).toThrow(SyntaxError);
	});

	it.each(['/static/images/', '/api/v', '/a/y', '/(/', '/x*/'.replace('*', '+')])(
		'takes %s as plain text with the literal option',
		(pattern) => {
			expect(compileSearchPattern(pattern, { literal: true })).toEqual({
				source: pattern,
				literal: true,
				ignoreCase: false,
				multiLine: false,
				dotAll: false,
			});
		},
	);

	it('still rejects an empty pattern with the literal option', () => {
		expect(() => compileSearchPattern('', { literal: true })).toThrow(
			/must not match the empty string/,
		);
	});

	it('points to the literal option when the flag is not supported', () => {
		expect(() => compileSearchPattern('/api/v')).toThrow(/--literal/);
	});
});
