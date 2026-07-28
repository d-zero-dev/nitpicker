import { describe, expect, it } from 'vitest';

import { resolveListLimit } from './resolve-list-limit.js';

describe('resolveListLimit', () => {
	it('returns the requested limit when it is a non-negative integer', () => {
		expect(resolveListLimit(50, 100)).toBe(50);
	});

	it('returns the default when limit is undefined', () => {
		expect(resolveListLimit(undefined, 100)).toBe(100);
	});

	it('returns the default when limit is negative', () => {
		expect(resolveListLimit(-1, 100)).toBe(100);
	});

	it('returns the default when limit is not an integer', () => {
		expect(resolveListLimit(1.5, 100)).toBe(100);
	});

	it('accepts zero as a valid limit', () => {
		expect(resolveListLimit(0, 100)).toBe(0);
	});
});
