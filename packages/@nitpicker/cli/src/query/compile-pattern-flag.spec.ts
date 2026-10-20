import { describe, expect, it } from 'vitest';

import { compilePatternFlag } from './compile-pattern-flag.js';

describe('compilePatternFlag', () => {
	it('reads a /…/flags pattern as a regular expression', () => {
		expect(compilePatternFlag('/a+/i')).toMatchObject({
			source: 'a+',
			literal: false,
			ignoreCase: true,
		});
	});

	it('reads the whole string as text with --literal, whatever it looks like', () => {
		expect(compilePatternFlag('/static/images/', true)).toMatchObject({
			source: '/static/images/',
			literal: true,
		});
		expect(compilePatternFlag('/api/v', true)).toMatchObject({
			source: '/api/v',
			literal: true,
		});
	});

	it('names the flag and the reason when the pattern is refused, with the cause attached', () => {
		let error: unknown;
		try {
			compilePatternFlag('/(/', false);
		} catch (error_) {
			error = error_;
		}
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toMatch(
			/^Invalid --pattern value: \/\(\/ \([\s\S]*unclosed group/,
		);
		expect((error as Error).cause).toBeInstanceOf(SyntaxError);
	});

	it('points to --literal when /api/v is read as a regular expression with an unsupported flag', () => {
		expect(() => compilePatternFlag('/api/v', false)).toThrow(/--literal/);
	});
});
