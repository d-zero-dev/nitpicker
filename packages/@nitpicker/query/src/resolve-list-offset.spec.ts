import { describe, expect, it } from 'vitest';

import { resolveListOffset } from './resolve-list-offset.js';

describe('resolveListOffset', () => {
	it('returns the requested offset when it is a non-negative integer', () => {
		expect(resolveListOffset(20)).toBe(20);
	});

	it('returns 0 when offset is undefined', () => {
		expect(resolveListOffset()).toBe(0);
	});

	it('returns 0 when offset is negative', () => {
		expect(resolveListOffset(-1)).toBe(0);
	});

	it('returns 0 when offset is not an integer', () => {
		expect(resolveListOffset(1.5)).toBe(0);
	});
});
