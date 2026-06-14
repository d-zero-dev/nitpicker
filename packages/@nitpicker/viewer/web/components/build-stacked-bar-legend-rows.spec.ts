import { CONTENT_TYPE_CATEGORIES } from '@nitpicker/query/categories';
import { describe, expect, it } from 'vitest';

import { buildStackedBarLegendRows } from './build-stacked-bar-legend-rows.js';

describe('buildStackedBarLegendRows', () => {
	it('returns one row per known category', () => {
		const rows = buildStackedBarLegendRows([]);
		expect(rows.map((r) => r.entry.category)).toEqual([...CONTENT_TYPE_CATEGORIES]);
	});

	it('reports zero counts for absent categories (legend shows the full taxonomy)', () => {
		const rows = buildStackedBarLegendRows([
			{ category: 'html', internal: 5, external: 0 },
		]);
		const pdfRow = rows.find((r) => r.entry.category === 'pdf');
		expect(pdfRow).toBeDefined();
		expect(pdfRow!.entry.total).toBe(0);
		expect(pdfRow!.ratio).toBe(0);
		expect(pdfRow!.width).toBe(0);
	});

	it('computes shares against the grand total across the input entries', () => {
		const rows = buildStackedBarLegendRows([
			{ category: 'html', internal: 60, external: 0 },
			{ category: 'pdf', internal: 40, external: 0 },
		]);
		const html = rows.find((r) => r.entry.category === 'html')!;
		const pdf = rows.find((r) => r.entry.category === 'pdf')!;
		expect(html.ratio).toBeCloseTo(0.6, 5);
		expect(pdf.ratio).toBeCloseTo(0.4, 5);
	});

	it('keeps the order stable as `CONTENT_TYPE_CATEGORIES` (input order is ignored)', () => {
		const rows = buildStackedBarLegendRows([
			{ category: 'pdf', internal: 1, external: 0 },
			{ category: 'html', internal: 1, external: 0 },
		]);
		expect(rows.map((r) => r.entry.category)).toEqual([...CONTENT_TYPE_CATEGORIES]);
	});

	it('returns all zeros when the input is empty', () => {
		const rows = buildStackedBarLegendRows([]);
		expect(rows.every((r) => r.entry.total === 0)).toBe(true);
		expect(rows.every((r) => r.ratio === 0)).toBe(true);
	});

	it('forwards both internal and external counts onto the visible entry', () => {
		const rows = buildStackedBarLegendRows([
			{ category: 'image', internal: 2, external: 3 },
		]);
		const image = rows.find((r) => r.entry.category === 'image')!;
		expect(image.entry.internal).toBe(2);
		expect(image.entry.external).toBe(3);
		expect(image.entry.total).toBe(5);
	});

	it('grand total agrees with the bar (legend and bar must share denominator)', async () => {
		/* The bar's grandTotal is `Σ (internal + external)` over the
		   visible (non-zero) entries built by buildStackedBarEntries; the
		   legend's grandTotal is `Σ (internal + external)` over the same
		   input. They must be equal — divergence would make the segment
		   percent and the legend percent disagree silently. This spec
		   ensures both helpers see the same denominator even though they
		   compute it via different code paths today. */
		const { buildStackedBarRows } = await import('./build-stacked-bar-rows.js');
		const input = [
			{ category: 'html', internal: 5, external: 3 },
			{ category: 'pdf', internal: 2, external: 0 },
			{ category: 'image', internal: 0, external: 0 },
		] as const;
		const legend = buildStackedBarLegendRows(input);
		const bar = buildStackedBarRows(input);
		const legendTotal = legend.reduce((acc, row) => acc + row.entry.total, 0);
		const barTotal = bar.reduce((acc, row) => acc + row.entry.total, 0);
		expect(legendTotal).toBe(barTotal);
		expect(legendTotal).toBe(10);
	});
});
