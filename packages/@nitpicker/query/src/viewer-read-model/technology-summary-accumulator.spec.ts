import type { TechnologySourceRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { buildTechnologySummaryRows } from './build-technology-summary-rows.js';
import { TechnologySummaryAccumulator } from './technology-summary-accumulator.js';

const ROWS: TechnologySourceRow[] = [
	{ url: 'https://example.com/a', technology: 'Astro', category: null, confidence: 70 },
	{ url: 'https://example.com/b', technology: 'React', category: 'JS', confidence: 100 },
	{ url: 'https://example.com/c', technology: 'Astro', category: 'SSG', confidence: 91 },
	{ url: 'https://example.com/d', technology: 'Vue', category: null, confidence: 50 },
	{
		url: 'https://example.com/e',
		technology: 'React',
		category: 'Other',
		confidence: 51,
	},
];

describe('TechnologySummaryAccumulator', () => {
	it('gives the same rows, in the same order, as one batch call however the rows are split', () => {
		const expected = buildTechnologySummaryRows(ROWS);
		for (const splitAt of [0, 1, 2, 3, 4, 5]) {
			const accumulator = new TechnologySummaryAccumulator();
			accumulator.add(ROWS.slice(0, splitAt));
			accumulator.add(ROWS.slice(splitAt));
			expect(accumulator.toRows()).toEqual(expected);
		}
	});

	it('produces the rows worked out by hand for the fixture, in first-seen order', () => {
		const accumulator = new TechnologySummaryAccumulator();
		accumulator.add(ROWS);
		// Astro: 70 + 91 over 2 rows → 80.5 → 81 (rounds half up), first non-null
		// category 'SSG'. React: (100 + 51) / 2 = 75.5 → 76, first category 'JS'.
		// Vue: 50, no category.
		expect(accumulator.toRows()).toEqual([
			{
				technology: 'Astro',
				category: 'SSG',
				detected_page_count: 2,
				avg_confidence: 81,
			},
			{ technology: 'React', category: 'JS', detected_page_count: 2, avg_confidence: 76 },
			{ technology: 'Vue', category: null, detected_page_count: 1, avg_confidence: 50 },
		]);
	});

	it('keeps the first non-null category and rounds the mean confidence', () => {
		const accumulator = new TechnologySummaryAccumulator();
		accumulator.add(ROWS);
		const astro = accumulator.toRows().find((row) => row.technology === 'Astro');
		expect(astro).toEqual({
			technology: 'Astro',
			category: 'SSG',
			detected_page_count: 2,
			avg_confidence: 81,
		});
	});

	it('is empty when nothing was added', () => {
		expect(new TechnologySummaryAccumulator().toRows()).toEqual([]);
	});

	it('does not keep the rows it was given', () => {
		const accumulator = new TechnologySummaryAccumulator();
		const chunk = [...ROWS];
		accumulator.add(chunk);
		chunk.length = 0;
		expect(accumulator.toRows()).toHaveLength(3);
	});
});
