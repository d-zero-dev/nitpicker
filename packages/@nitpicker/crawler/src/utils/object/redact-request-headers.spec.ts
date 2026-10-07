import { describe, expect, it } from 'vitest';

import { redactRequestHeaders } from './redact-request-headers.js';

describe('redactRequestHeaders', () => {
	it('masks every header value but keeps the names', () => {
		const result = redactRequestHeaders({
			userAgent: 'x',
			requestHeaders: { Authorization: 'Bearer secret', 'X-Api-Key': 'k' },
		});
		expect(result).toEqual({
			userAgent: 'x',
			requestHeaders: { Authorization: '***', 'X-Api-Key': '***' },
		});
	});

	it('does not mutate the input', () => {
		const input = { requestHeaders: { Authorization: 'Bearer secret' } };
		redactRequestHeaders(input);
		expect(input.requestHeaders.Authorization).toBe('Bearer secret');
	});

	it('returns the config unchanged when there are no request headers', () => {
		const input = { userAgent: 'x' };
		expect(redactRequestHeaders(input)).toBe(input);
	});
});
