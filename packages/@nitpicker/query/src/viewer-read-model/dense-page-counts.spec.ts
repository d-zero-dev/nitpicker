import { describe, expect, it } from 'vitest';

import { DensePageCounts } from './dense-page-counts.js';

describe('DensePageCounts', () => {
	it('reads 0 for a page nothing was counted for', () => {
		const counts = new DensePageCounts(10);
		expect(counts.get(3)).toBe(0);
	});

	it('counts increments per page id', () => {
		const counts = new DensePageCounts(10);
		counts.increment(3);
		counts.increment(3);
		counts.increment(7);
		expect(counts.get(3)).toBe(2);
		expect(counts.get(7)).toBe(1);
		expect(counts.get(0)).toBe(0);
	});

	it('accepts the largest id the capacity allows', () => {
		const counts = new DensePageCounts(5);
		counts.increment(4);
		expect(counts.get(4)).toBe(1);
	});

	it('counts an id outside the capacity exactly, as a map would', () => {
		const counts = new DensePageCounts(5);
		counts.increment(5);
		counts.increment(5);
		counts.increment(1_000_000);
		expect(counts.get(5)).toBe(2);
		expect(counts.get(1_000_000)).toBe(1);
		expect(counts.get(4)).toBe(0);
	});

	it('counts an id that is not a non-negative integer, as a map would', () => {
		const counts = new DensePageCounts(5);
		counts.increment(-1);
		counts.increment(1.5);
		counts.increment(1.5);
		expect(counts.get(-1)).toBe(1);
		expect(counts.get(1.5)).toBe(2);
		expect(counts.get(1)).toBe(0);
	});

	it('reads 0 for an id nothing was counted for, inside or outside the capacity', () => {
		const counts = new DensePageCounts(5);
		expect(counts.get(99)).toBe(0);
		expect(counts.get(2)).toBe(0);
	});

	it('works for a zero capacity (an archive with no pages)', () => {
		const counts = new DensePageCounts(0);
		expect(counts.get(1)).toBe(0);
		counts.increment(0);
		expect(counts.get(0)).toBe(1);
	});
});
