import type { TechnologySourceRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { buildTechnologySummaryRows } from './build-technology-summary-rows.js';

describe('buildTechnologySummaryRows', () => {
	it('aggregates page count and mean confidence per technology', () => {
		const rows: TechnologySourceRow[] = [
			{
				url: 'https://example.com/a',
				technology: 'Next.js',
				category: 'JS',
				confidence: 80,
			},
			{
				url: 'https://example.com/b',
				technology: 'Next.js',
				category: 'JS',
				confidence: 60,
			},
			{ url: 'https://example.com/c', technology: 'Vue', category: null, confidence: 40 },
		];
		const result = buildTechnologySummaryRows(rows).toSorted((a, b) =>
			a.technology < b.technology ? -1 : 1,
		);
		expect(result).toEqual([
			{
				technology: 'Next.js',
				category: 'JS',
				detected_page_count: 2,
				avg_confidence: 70,
			},
			{ technology: 'Vue', category: null, detected_page_count: 1, avg_confidence: 40 },
		]);
	});

	it('backfills category from a later row when the first is null', () => {
		const rows: TechnologySourceRow[] = [
			{
				url: 'https://example.com/a',
				technology: 'Astro',
				category: null,
				confidence: 50,
			},
			{
				url: 'https://example.com/b',
				technology: 'Astro',
				category: 'Static site generator',
				confidence: 70,
			},
		];
		const [result] = buildTechnologySummaryRows(rows);
		expect(result?.category).toBe('Static site generator');
	});

	it('returns an empty array for no rows', () => {
		expect(buildTechnologySummaryRows([])).toEqual([]);
	});
});
