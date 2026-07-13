import { describe, it, expect } from 'vitest';

import { isVolatileHeader } from './header-stability.js';
import { VOLATILE_HEADER_NAMES } from './volatile-header-names.js';

describe('isVolatileHeader', () => {
	it('classifies known volatile headers as volatile', () => {
		expect(isVolatileHeader('Date')).toBe(true);
		expect(isVolatileHeader('etag')).toBe(true);
		expect(isVolatileHeader('CF-Ray')).toBe(true);
		expect(isVolatileHeader('Set-Cookie')).toBe(true);
	});

	it('classifies known stable headers as not-volatile', () => {
		expect(isVolatileHeader('Content-Type')).toBe(false);
		expect(isVolatileHeader('Strict-Transport-Security')).toBe(false);
		expect(isVolatileHeader('cache-control')).toBe(false);
	});

	it('treats unknown headers as stable (safer default)', () => {
		expect(isVolatileHeader('X-Made-Up-Header')).toBe(false);
	});

	it('is case-insensitive', () => {
		expect(isVolatileHeader('DATE')).toBe(true);
		expect(isVolatileHeader('date')).toBe(true);
		expect(isVolatileHeader('Date')).toBe(true);
	});
});

describe('VOLATILE_HEADER_NAMES', () => {
	it('contains lower-cased entries only', () => {
		for (const name of VOLATILE_HEADER_NAMES) {
			expect(name).toBe(name.toLowerCase());
		}
	});

	it('includes the plan-mandated volatile headers', () => {
		const expected = [
			'date',
			'expires',
			'last-modified',
			'etag',
			'age',
			'via',
			'x-cache',
			'cf-ray',
			'x-request-id',
			'set-cookie',
			'server-timing',
			'x-amz-request-id',
		];
		for (const name of expected) {
			expect(VOLATILE_HEADER_NAMES.has(name), `${name} missing`).toBe(true);
		}
	});
});
