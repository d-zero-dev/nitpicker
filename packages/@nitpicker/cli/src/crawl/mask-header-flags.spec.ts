import { describe, expect, it } from 'vitest';

import { maskHeaderFlags } from './mask-header-flags.js';

describe('maskHeaderFlags', () => {
	it('masks --header values but keeps the names', () => {
		expect(maskHeaderFlags({ header: ['X-Api-Key: secret', 'X-Other:  v2'] })).toEqual({
			header: ['X-Api-Key: ***', 'X-Other: ***'],
		});
	});

	it('masks --authorization', () => {
		expect(maskHeaderFlags({ authorization: 'Bearer secret' })).toEqual({
			authorization: '***',
		});
	});

	it('masks resolved requestHeaders values', () => {
		expect(
			maskHeaderFlags({ requestHeaders: { Authorization: 'Bearer secret' } }),
		).toEqual({ requestHeaders: { Authorization: '***' } });
	});

	it('masks a header entry that has no colon entirely', () => {
		expect(maskHeaderFlags({ header: ['oops-secret'] })).toEqual({ header: ['***'] });
	});

	it('keeps unrelated flags and does not mutate the input', () => {
		const input = {
			userAgent: 'ua',
			headerFile: 'headers.txt',
			authorization: 'Bearer secret',
		};
		const result = maskHeaderFlags(input);
		expect(result.userAgent).toBe('ua');
		expect(result.headerFile).toBe('headers.txt');
		expect(input.authorization).toBe('Bearer secret');
	});

	it('leaves flags without header keys untouched', () => {
		expect(maskHeaderFlags({ userAgent: 'ua' })).toEqual({ userAgent: 'ua' });
	});
});
