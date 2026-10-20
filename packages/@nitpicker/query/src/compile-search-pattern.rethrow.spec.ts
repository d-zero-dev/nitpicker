import { describe, it, expect, vi } from 'vitest';

import { compileSearchPattern } from './compile-search-pattern.js';

const failure = vi.hoisted(() => ({ error: new Error('native binding failed to load') }));

vi.mock('@nitpicker/archive/html-snapshot/validate-search-pattern', () => ({
	validateSearchPattern: () => {
		throw failure.error;
	},
}));

describe('compileSearchPattern when the native call fails for another reason', () => {
	it('rethrows an error that is not the engine refusing the pattern, instead of calling it a SyntaxError', () => {
		expect(() => compileSearchPattern('/a/')).toThrow(failure.error);
		expect(() => compileSearchPattern('a')).not.toThrow(SyntaxError);
	});

	it('still maps the engine refusing the pattern (InvalidArg) to a SyntaxError', () => {
		failure.error = Object.assign(new Error('unclosed group'), { code: 'InvalidArg' });
		expect(() => compileSearchPattern('/(/')).toThrow(SyntaxError);
	});
});
