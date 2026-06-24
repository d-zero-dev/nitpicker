import { describe, expect, it } from 'vitest';

import { buildPagerWindow } from './build-pager-window.js';

describe('buildPagerWindow', () => {
	it('returns just [1] when there is a single page', () => {
		expect(buildPagerWindow(1, 1)).toEqual([1]);
	});

	it('returns [1, 2] when there are exactly two pages', () => {
		expect(buildPagerWindow(2, 1)).toEqual([1, 2]);
		expect(buildPagerWindow(2, 2)).toEqual([1, 2]);
	});

	it('renders all numbers with no ellipses when the window covers everything', () => {
		expect(buildPagerWindow(5, 3, 1)).toEqual([1, 2, 3, 4, 5]);
	});

	it('inserts a trailing ellipsis when the current page is near the start', () => {
		expect(buildPagerWindow(20, 2, 1)).toEqual([1, 2, 3, 'ellipsis-end', 20]);
	});

	it('inserts a leading ellipsis when the current page is near the end', () => {
		expect(buildPagerWindow(20, 19, 1)).toEqual([1, 'ellipsis-start', 18, 19, 20]);
	});

	it('bridges a single hidden page instead of rendering an ellipsis (leading)', () => {
		// Without the bridge: pages=4, current=4 would emit [1, …, 3, 4] — but
		// the only hidden page is 2, so we render it directly as a clickable
		// number. Ellipses are reserved for ≥ 2 hidden pages.
		expect(buildPagerWindow(4, 4, 1)).toEqual([1, 2, 3, 4]);
	});

	it('bridges a single hidden page instead of rendering an ellipsis (trailing)', () => {
		// Symmetric to the leading case: pages=4, current=1 would otherwise
		// emit [1, 2, …, 4] (single hidden page 3). Bridge to [1, 2, 3, 4].
		expect(buildPagerWindow(4, 1, 1)).toEqual([1, 2, 3, 4]);
	});

	it('bridges both sides simultaneously (pages=7, current=4, span=1)', () => {
		// Hidden pages would be {2, 6}, one on each side. Both are bridged so
		// the operator sees every page as a clickable number.
		expect(buildPagerWindow(7, 4, 1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	it('inserts both ellipses for a far-mid current page', () => {
		expect(buildPagerWindow(20, 10, 1)).toEqual([
			1,
			'ellipsis-start',
			9,
			10,
			11,
			'ellipsis-end',
			20,
		]);
	});

	it('expands the sibling window when siblings > 1', () => {
		expect(buildPagerWindow(20, 10, 2)).toEqual([
			1,
			'ellipsis-start',
			8,
			9,
			10,
			11,
			12,
			'ellipsis-end',
			20,
		]);
	});

	it('clamps a current page above totalPages to the last page', () => {
		expect(buildPagerWindow(5, 99, 1)).toEqual([1, 'ellipsis-start', 4, 5]);
	});

	it('clamps a current page below 1 to the first page', () => {
		expect(buildPagerWindow(5, 0, 1)).toEqual([1, 2, 'ellipsis-end', 5]);
		expect(buildPagerWindow(5, -3, 1)).toEqual([1, 2, 'ellipsis-end', 5]);
	});

	it('treats totalPages ≤ 0 as 1 page', () => {
		expect(buildPagerWindow(0, 1)).toEqual([1]);
		expect(buildPagerWindow(-5, 1)).toEqual([1]);
	});

	it('never repeats a page number', () => {
		const tokens = buildPagerWindow(8, 4, 1);
		const numbers = tokens.filter((t): t is number => typeof t === 'number');
		expect(new Set(numbers).size).toBe(numbers.length);
	});

	it('emits monotonically increasing page numbers', () => {
		const tokens = buildPagerWindow(100, 42, 2);
		const numbers = tokens.filter((t): t is number => typeof t === 'number');
		for (let index = 1; index < numbers.length; index++) {
			expect(numbers[index]).toBeGreaterThan(numbers[index - 1]!);
		}
	});
});
