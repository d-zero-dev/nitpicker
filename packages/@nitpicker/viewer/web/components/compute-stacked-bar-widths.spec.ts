import type { VisibleEntry } from './build-stacked-bar-entries.js';

import { describe, expect, it } from 'vitest';

import { computeStackedBarWidths } from './compute-stacked-bar-widths.js';

/**
 * Constructs a {@link VisibleEntry} fixture with a given total. The
 * internal/external split doesn't affect width math, so the fixture pins
 * everything to internal — the tests assert against totals only.
 * @param category - Any valid category (used as the key).
 * @param total - The total count for this entry.
 * @returns A VisibleEntry with `total` equal to `internal`.
 */
function entry(category: VisibleEntry['category'], total: number): VisibleEntry {
	return { category, internal: total, external: 0, total };
}

describe('computeStackedBarWidths', () => {
	it('returns an empty array when grandTotal is zero', () => {
		expect(computeStackedBarWidths([entry('html', 0)], 0)).toEqual([]);
	});

	it('returns an empty array when no entries are visible', () => {
		expect(computeStackedBarWidths([], 100)).toEqual([]);
	});

	it('produces shares proportional to each entry total', () => {
		const widths = computeStackedBarWidths([entry('html', 60), entry('pdf', 40)], 100);
		expect(widths[0]).toBeCloseTo(60, 5);
		expect(widths[1]).toBeCloseTo(40, 5);
	});

	it('preserves the input order (no internal sort)', () => {
		const widths = computeStackedBarWidths(
			[entry('pdf', 50), entry('html', 30), entry('image', 20)],
			100,
		);
		expect(widths).toHaveLength(3);
		expect(widths[0]).toBeCloseTo(50, 5);
		expect(widths[1]).toBeCloseTo(30, 5);
		expect(widths[2]).toBeCloseTo(20, 5);
	});

	it('returns 100 for a single visible entry', () => {
		expect(computeStackedBarWidths([entry('html', 42)], 42)).toEqual([100]);
	});

	it('returns sub-percent widths verbatim — no JS renormalisation, the CSS floor handles visibility', () => {
		/* `image` is 0.1% of the total. The old implementation lifted this
		   to 0.5% in JS and renormalised, which made the legend percentage
		   silently disagree with the bar width. The new contract: JS
		   returns the raw share (0.1), CSS lifts the rendered segment via
		   `min-inline-size: 4px` on `.bar-segment`. Pure data, no
		   renormalisation. The trailing sum-to-100 assertion pins that
		   contract: any future re-introduction of a JS floor would break
		   either the verbatim 0.1 or the 100-total. */
		const widths = computeStackedBarWidths([entry('html', 999), entry('image', 1)], 1000);
		expect(widths[0]).toBeCloseTo(99.9, 5);
		expect(widths[1]).toBeCloseTo(0.1, 5);
		expect(widths.reduce((acc, w) => acc + w, 0)).toBeCloseTo(100, 5);
	});
});
