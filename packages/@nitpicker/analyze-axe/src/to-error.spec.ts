import { describe, it, expect } from 'vitest';

import { toError } from './to-error.js';

describe('toError', () => {
	it('returns the same Error instance when given an Error', () => {
		const original = new Error('original message');
		const result = toError(original);
		expect(result).toBe(original);
	});

	it('preserves the stack trace of the original Error', () => {
		const original = new Error('with stack');
		const result = toError(original);
		expect(result.stack).toBe(original.stack);
	});

	it('wraps a string into a new Error', () => {
		const result = toError('string message');
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('string message');
	});

	it('wraps a number into a new Error', () => {
		const result = toError(42);
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('42');
	});

	it('wraps null into a new Error', () => {
		const result = toError(null);
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('null');
	});

	it('wraps undefined into a new Error', () => {
		const result = toError();
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('undefined');
	});

	it('preserves subclass instances of Error', () => {
		const original = new TypeError('type error');
		const result = toError(original);
		expect(result).toBe(original);
		expect(result).toBeInstanceOf(TypeError);
		expect(result.stack).toBe(original.stack);
	});
});
