import type { TechnologySourceRow } from './types.js';

import { describe, expect, it } from 'vitest';

import { buildTechnologyDirectoryStatsRows } from './build-technology-directory-stats-rows.js';
import { TechnologyDirectoryStatsAccumulator } from './technology-directory-stats-accumulator.js';

const ROWS: TechnologySourceRow[] = [
	{
		url: 'https://example.com/blog/a',
		technology: 'Astro',
		category: null,
		confidence: 1,
	},
	{
		url: 'https://example.com/app/b',
		technology: 'React',
		category: null,
		confidence: 1,
	},
	{
		url: 'https://example.com/blog/c',
		technology: 'Astro',
		category: null,
		confidence: 1,
	},
	{ url: 'https://example.com/', technology: 'Astro', category: null, confidence: 1 },
	{
		url: 'https://other.example:8080/x/y',
		technology: 'Vue',
		category: null,
		confidence: 1,
	},
	{ url: 'not a url', technology: 'Astro', category: null, confidence: 1 },
	{
		url: 'https://example.com/blog/d',
		technology: 'React',
		category: null,
		confidence: 1,
	},
];

describe('TechnologyDirectoryStatsAccumulator', () => {
	it('gives the same rows, in the same order, as one batch call however the rows are split', () => {
		const expected = buildTechnologyDirectoryStatsRows(ROWS);
		for (const splitAt of [0, 1, 3, 5, 7]) {
			const accumulator = new TechnologyDirectoryStatsAccumulator();
			accumulator.add(ROWS.slice(0, splitAt));
			accumulator.add(ROWS.slice(splitAt));
			expect(accumulator.toRows()).toEqual(expected);
		}
	});

	it('produces the buckets worked out by hand for the fixture, in first-seen order', () => {
		const accumulator = new TechnologyDirectoryStatsAccumulator();
		accumulator.add(ROWS);
		expect(accumulator.toRows()).toEqual([
			{
				root_key: 'https://example.com',
				directory: 'https://example.com/blog/',
				technology: 'Astro',
				page_count: 2,
			},
			{
				root_key: 'https://example.com',
				directory: 'https://example.com/app/',
				technology: 'React',
				page_count: 1,
			},
			{
				root_key: 'https://example.com',
				directory: 'https://example.com/',
				technology: 'Astro',
				page_count: 1,
			},
			{
				root_key: 'https://other.example:8080',
				directory: 'https://other.example:8080/x/',
				technology: 'Vue',
				page_count: 1,
			},
			{
				root_key: 'https://example.com',
				directory: 'https://example.com/blog/',
				technology: 'React',
				page_count: 1,
			},
		]);
	});

	it('skips an unparseable URL and counts per (directory, technology)', () => {
		const accumulator = new TechnologyDirectoryStatsAccumulator();
		accumulator.add(ROWS);
		const rows = accumulator.toRows();
		expect(rows).toContainEqual({
			root_key: 'https://example.com',
			directory: 'https://example.com/blog/',
			technology: 'Astro',
			page_count: 2,
		});
		expect(rows).toContainEqual({
			root_key: 'https://other.example:8080',
			directory: 'https://other.example:8080/x/',
			technology: 'Vue',
			page_count: 1,
		});
		expect(rows.some((row) => row.directory.includes('not a url'))).toBe(false);
	});

	it('does not merge a technology name or directory that contains a space with another pair', () => {
		const accumulator = new TechnologyDirectoryStatsAccumulator();
		accumulator.add([
			{
				url: 'https://example.com/a/p',
				technology: 'B C',
				category: null,
				confidence: 1,
			},
			{ url: 'https://example.com/a/q', technology: 'B', category: null, confidence: 1 },
		]);
		expect(accumulator.toRows()).toHaveLength(2);
	});

	it('is empty when nothing was added', () => {
		expect(new TechnologyDirectoryStatsAccumulator().toRows()).toEqual([]);
	});
});
