import type { TechnologySourceRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { buildTechnologyDirectoryStatsRows } from './build-technology-directory-stats-rows.js';

describe('buildTechnologyDirectoryStatsRows', () => {
	it('buckets by first-path-segment directory and technology', () => {
		const rows: TechnologySourceRow[] = [
			{
				url: 'https://example.com/blog/post-1',
				technology: 'Astro',
				category: null,
				confidence: 80,
			},
			{
				url: 'https://example.com/blog/post-2',
				technology: 'Astro',
				category: null,
				confidence: 80,
			},
			{
				url: 'https://example.com/app/dashboard',
				technology: 'Next.js',
				category: null,
				confidence: 80,
			},
		];
		const result = buildTechnologyDirectoryStatsRows(rows).toSorted((a, b) =>
			a.directory < b.directory ? -1 : 1,
		);
		expect(result).toEqual([
			{
				root_key: 'https://example.com',
				directory: 'https://example.com/app/',
				technology: 'Next.js',
				page_count: 1,
			},
			{
				root_key: 'https://example.com',
				directory: 'https://example.com/blog/',
				technology: 'Astro',
				page_count: 2,
			},
		]);
	});

	it('lets one page contribute to multiple technology rows in the same directory', () => {
		const rows: TechnologySourceRow[] = [
			{
				url: 'https://example.com/blog/post-1',
				technology: 'Astro',
				category: null,
				confidence: 80,
			},
			{
				url: 'https://example.com/blog/post-1',
				technology: 'Vue',
				category: null,
				confidence: 60,
			},
		];
		const result = buildTechnologyDirectoryStatsRows(rows);
		expect(result).toHaveLength(2);
		expect(result.every((r) => r.page_count === 1)).toBe(true);
	});

	it('buckets root-only URLs (no path segment) under the origin directory', () => {
		const rows: TechnologySourceRow[] = [
			{
				url: 'https://example.com/',
				technology: 'Astro',
				category: null,
				confidence: 80,
			},
		];
		const [result] = buildTechnologyDirectoryStatsRows(rows);
		expect(result?.directory).toBe('https://example.com/');
	});

	it('skips unparseable URLs', () => {
		const rows: TechnologySourceRow[] = [
			{ url: 'not a url', technology: 'Astro', category: null, confidence: 80 },
		];
		expect(buildTechnologyDirectoryStatsRows(rows)).toEqual([]);
	});

	it('returns an empty array for no rows', () => {
		expect(buildTechnologyDirectoryStatsRows([])).toEqual([]);
	});
});
