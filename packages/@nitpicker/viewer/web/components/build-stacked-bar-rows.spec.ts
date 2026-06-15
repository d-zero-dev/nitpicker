import { describe, expect, it } from 'vitest';

import { buildStackedBarRows } from './build-stacked-bar-rows.js';

describe('buildStackedBarRows', () => {
	it('returns an empty array for an empty input', () => {
		expect(buildStackedBarRows([])).toEqual([]);
	});

	it('returns an empty array when every category has zero count', () => {
		const rows = buildStackedBarRows([
			{ category: 'html', internal: 0, external: 0 },
			{ category: 'pdf', internal: 0, external: 0 },
		]);
		expect(rows).toEqual([]);
	});

	it('joins entry + width + ratio for each non-zero category', () => {
		const rows = buildStackedBarRows([
			{ category: 'html', internal: 60, external: 0 },
			{ category: 'pdf', internal: 40, external: 0 },
		]);
		expect(rows).toHaveLength(2);
		expect(rows[0].entry.category).toBe('html');
		expect(rows[0].width).toBeCloseTo(60, 5);
		expect(rows[0].ratio).toBeCloseTo(0.6, 5);
		expect(rows[1].entry.category).toBe('pdf');
		expect(rows[1].width).toBeCloseTo(40, 5);
		expect(rows[1].ratio).toBeCloseTo(0.4, 5);
	});

	it('orders rows by total descending (largest first)', () => {
		const rows = buildStackedBarRows([
			{ category: 'html', internal: 10, external: 0 },
			{ category: 'pdf', internal: 50, external: 0 },
			{ category: 'image', internal: 30, external: 0 },
		]);
		expect(rows.map((r) => r.entry.category)).toEqual(['pdf', 'image', 'html']);
	});

	it('keeps width and ratio coupled to the same entry (no index drift)', () => {
		/* Off-by-one between the sorted entries and the widths array would
		   put the html width on the pdf row. This spec is the regression
		   net for that class of bug. */
		const rows = buildStackedBarRows([
			{ category: 'pdf', internal: 90, external: 0 },
			{ category: 'html', internal: 10, external: 0 },
		]);
		for (const row of rows) {
			expect(row.ratio).toBeCloseTo(row.width / 100, 5);
		}
	});

	it('drops zero-count entries while keeping non-zero ones', () => {
		const rows = buildStackedBarRows([
			{ category: 'html', internal: 0, external: 0 },
			{ category: 'pdf', internal: 5, external: 0 },
			{ category: 'image', internal: 0, external: 0 },
		]);
		expect(rows.map((r) => r.entry.category)).toEqual(['pdf']);
	});

	it('preserves external-only categories', () => {
		const rows = buildStackedBarRows([{ category: 'image', internal: 0, external: 3 }]);
		expect(rows).toHaveLength(1);
		expect(rows[0].entry.external).toBe(3);
		expect(rows[0].ratio).toBeCloseTo(1, 5);
	});
});
