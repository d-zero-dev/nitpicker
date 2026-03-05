import { describe, it, expect } from 'vitest';

import { toError } from './to-error.js';

describe('toError', () => {
	it('returns the same Error instance when given an Error', () => {
		const original = new Error('original message');
		const result = toError(original);
		expect(result).toBe(original);
	});

	it('wraps a string into a new Error', () => {
		const result = toError('string message');
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('string message');
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
	});
});
