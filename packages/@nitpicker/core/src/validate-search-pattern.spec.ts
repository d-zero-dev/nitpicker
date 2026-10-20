import type { NativeSearchPattern } from './types.js';

import { describe, it, expect } from 'vitest';

import { validateSearchPattern } from './validate-search-pattern.js';

/**
 * A regular-expression pattern.
 * @param source - The regular expression's source.
 */
function regex(source: string): NativeSearchPattern {
	return { source, literal: false, ignoreCase: false, multiLine: false, dotAll: false };
}

describe('validateSearchPattern', () => {
	it('reports whether the pattern matches the empty string', () => {
		expect(validateSearchPattern(regex('a+'))).toBe(false);
		expect(validateSearchPattern(regex('a*'))).toBe(true);
		expect(validateSearchPattern(regex('^'))).toBe(true);
	});

	it('passes a pattern that matches empty only inside a document, which the empty string has no boundary for', () => {
		expect(validateSearchPattern(regex(String.raw`\b`))).toBe(false);
	});

	it('takes a literal as text, so special characters are not syntax', () => {
		expect(validateSearchPattern({ ...regex('(?=a'), literal: true })).toBe(false);
	});

	it('throws InvalidArg with the engine message for an unsupported construct', () => {
		expect(() => validateSearchPattern(regex('(?=a)a'))).toThrow(
			expect.objectContaining({ code: 'InvalidArg' }),
		);
		expect(() => validateSearchPattern(regex('('))).toThrow(/unclosed group/);
	});
});
