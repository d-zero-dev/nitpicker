import { describe, expect, it } from 'vitest';

import { parseJumpTarget } from './parse-jump-target.js';

describe('parseJumpTarget', () => {
	it('returns null for an empty input', () => {
		expect(parseJumpTarget('', 10)).toBeNull();
	});

	it('returns null for whitespace-only input', () => {
		expect(parseJumpTarget('   ', 10)).toBeNull();
		expect(parseJumpTarget('\t', 10)).toBeNull();
	});

	it('returns null for non-numeric strings', () => {
		expect(parseJumpTarget('abc', 10)).toBeNull();
		expect(parseJumpTarget('1abc', 10)).toBeNull();
	});

	it('returns null for non-finite numbers (Infinity / NaN)', () => {
		expect(parseJumpTarget('Infinity', 10)).toBeNull();
		expect(parseJumpTarget('NaN', 10)).toBeNull();
	});

	it('passes a valid in-range integer through unchanged', () => {
		expect(parseJumpTarget('5', 10)).toBe(5);
		expect(parseJumpTarget('1', 10)).toBe(1);
		expect(parseJumpTarget('10', 10)).toBe(10);
	});

	it('clamps below-range numbers up to 1', () => {
		expect(parseJumpTarget('0', 10)).toBe(1);
		expect(parseJumpTarget('-5', 10)).toBe(1);
		expect(parseJumpTarget('-999', 10)).toBe(1);
	});

	it('clamps over-range numbers down to totalPages', () => {
		expect(parseJumpTarget('11', 10)).toBe(10);
		expect(parseJumpTarget('999', 10)).toBe(10);
		expect(parseJumpTarget('1e6', 10)).toBe(10);
	});

	it('floors fractional inputs (5.7 → 5, not 6)', () => {
		expect(parseJumpTarget('5.7', 10)).toBe(5);
		expect(parseJumpTarget('1.99', 10)).toBe(1);
	});

	it('treats totalPages ≤ 0 as 1 (clamp ceiling)', () => {
		expect(parseJumpTarget('5', 0)).toBe(1);
		expect(parseJumpTarget('1', -3)).toBe(1);
	});
});
