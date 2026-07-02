import { describe, expect, it } from 'vitest';

import { parseLegacyPagesCursor } from './parse-legacy-pages-cursor.js';

describe('parseLegacyPagesCursor', () => {
	it('falls back when cursor is undefined', () => {
		expect(parseLegacyPagesCursor(undefined, 5)).toBe(5);
	});

	it('falls back for an empty string', () => {
		expect(parseLegacyPagesCursor('', 5)).toBe(5);
	});

	it('parses a valid decimal offset', () => {
		expect(parseLegacyPagesCursor('100', 0)).toBe(100);
	});

	it('parses zero', () => {
		expect(parseLegacyPagesCursor('0', 5)).toBe(0);
	});

	it('falls back for a negative number', () => {
		expect(parseLegacyPagesCursor('-5', 5)).toBe(5);
	});

	it('falls back for a non-numeric string (e.g. a fast-path opaque cursor)', () => {
		expect(parseLegacyPagesCursor('not-a-number-xyz', 5)).toBe(5);
	});

	it('falls back for a non-integer number', () => {
		expect(parseLegacyPagesCursor('1.5', 5)).toBe(5);
	});
});
