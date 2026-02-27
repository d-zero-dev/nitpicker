import { describe, it, expect } from 'vitest';

import NetTimeoutError from './net-timeout-error.js';

describe('NetTimeoutError', () => {
	it('has the name NetTimeoutError', () => {
		const error = new NetTimeoutError();
		expect(error.name).toBe('NetTimeoutError');
	});

	it('includes the URL in the message when provided', () => {
		const error = new NetTimeoutError('https://example.com/');
		expect(error.message).toBe('Timeout: https://example.com/');
	});

	it('uses a generic message when no URL is provided', () => {
		const error = new NetTimeoutError();
		expect(error.message).toBe('Timeout');
	});

	it('is an instance of Error', () => {
		const error = new NetTimeoutError();
		expect(error).toBeInstanceOf(Error);
	});
});
