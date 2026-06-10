import type { ExURL } from '@d-zero/shared/parse-url';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, it, expect } from 'vitest';

import { partitionUrlsByHtml } from './partition-urls-by-html.js';

/**
 * Parse a list of URL strings into ExURL objects for test input.
 * @param raws - URL strings to parse.
 * @returns The parsed ExURL objects.
 */
function urls(raws: string[]): ExURL[] {
	return raws.map((raw) => parseUrl(raw)!);
}

/**
 * Map a partition result to its URL strings for readable assertions.
 * @param result - The `[html, other]` tuple from partitionUrlsByHtml.
 * @returns A `[html, other]` tuple of `withoutHashAndAuth` strings.
 */
function hrefs(result: [ExURL[], ExURL[]]): [string[], string[]] {
	return [
		result[0].map((u) => u.withoutHashAndAuth),
		result[1].map((u) => u.withoutHashAndAuth),
	];
}

describe('partitionUrlsByHtml', () => {
	it('splits a mixed batch into HTML and non-HTML groups', () => {
		const input = urls([
			'https://example.com/about',
			'https://example.com/photo.jpg',
			'https://example.com/contact.php',
			'https://example.com/styles.css',
		]);
		expect(hrefs(partitionUrlsByHtml(input))).toEqual([
			['https://example.com/about', 'https://example.com/contact.php'],
			['https://example.com/photo.jpg', 'https://example.com/styles.css'],
		]);
	});

	it('puts every URL in the HTML group when all are likely HTML', () => {
		const input = urls([
			'https://example.com/page/4',
			'https://example.com/page/5',
			'https://example.com/page/6',
		]);
		expect(hrefs(partitionUrlsByHtml(input))).toEqual([
			[
				'https://example.com/page/4',
				'https://example.com/page/5',
				'https://example.com/page/6',
			],
			[],
		]);
	});

	it('puts every URL in the other group when none are likely HTML', () => {
		const input = urls(['https://example.com/a.pdf', 'https://example.com/b.zip']);
		expect(hrefs(partitionUrlsByHtml(input))).toEqual([
			[],
			['https://example.com/a.pdf', 'https://example.com/b.zip'],
		]);
	});

	it('preserves input order within each group', () => {
		const input = urls([
			'https://example.com/3',
			'https://example.com/x.css',
			'https://example.com/1',
			'https://example.com/y.js',
			'https://example.com/2',
		]);
		expect(hrefs(partitionUrlsByHtml(input))).toEqual([
			['https://example.com/3', 'https://example.com/1', 'https://example.com/2'],
			['https://example.com/x.css', 'https://example.com/y.js'],
		]);
	});

	it('returns two empty groups for an empty input', () => {
		expect(partitionUrlsByHtml([])).toEqual([[], []]);
	});
});
