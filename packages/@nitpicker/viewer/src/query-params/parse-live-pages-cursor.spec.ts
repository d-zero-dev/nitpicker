import { describe, expect, it } from 'vitest';

import { parseLivePagesCursor } from './parse-live-pages-cursor.js';

describe('parseLivePagesCursor', () => {
	it('falls back when cursor is undefined', () => {
		expect(parseLivePagesCursor(undefined, 5)).toBe(5);
	});

	it('falls back for an empty string', () => {
		expect(parseLivePagesCursor('', 5)).toBe(5);
	});

	it('parses a valid decimal offset', () => {
		expect(parseLivePagesCursor('100', 0)).toBe(100);
	});

	it('parses zero', () => {
		expect(parseLivePagesCursor('0', 5)).toBe(0);
	});

	it('falls back for a negative number', () => {
		expect(parseLivePagesCursor('-5', 5)).toBe(5);
	});

	it('falls back for a non-numeric string (e.g. a fast-path opaque cursor)', () => {
		expect(parseLivePagesCursor('not-a-number-xyz', 5)).toBe(5);
	});

	it('falls back for a non-integer number', () => {
		expect(parseLivePagesCursor('1.5', 5)).toBe(5);
	});
});
