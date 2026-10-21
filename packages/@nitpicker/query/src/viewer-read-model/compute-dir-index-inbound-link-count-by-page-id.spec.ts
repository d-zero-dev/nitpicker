import type { DirIndexInboundLinkCountSourceRow } from './compute-dir-index-inbound-link-count-by-page-id.js';

import { describe, expect, it } from 'vitest';

import { computeDirIndexInboundLinkCountByPageId } from './compute-dir-index-inbound-link-count-by-page-id.js';
import { computePageDirKeys } from './compute-page-dir-keys.js';
import { DensePageCounts } from './dense-page-counts.js';

/**
 *
 * @param id
 * @param url
 */
function row(id: number, url: string): DirIndexInboundLinkCountSourceRow {
	return { id, url };
}

describe('computeDirIndexInboundLinkCountByPageId', () => {
	it('gives a lone directory index page its own inbound link count', () => {
		const rows = [row(1, 'https://example.com/blog/')];
		const counts = new Map([[1, 5]]);
		const result = computeDirIndexInboundLinkCountByPageId(rows, counts);
		expect(result.get(1)).toBe(5);
	});

	it('sums inbound link counts symmetrically across multiple index pages sharing a directory', () => {
		const rows = [
			row(1, 'https://example.com/blog/'),
			row(2, 'https://example.com/blog/index.html'),
		];
		const counts = new Map([
			[1, 3],
			[2, 7],
		]);
		const result = computeDirIndexInboundLinkCountByPageId(rows, counts);
		// Both index variants get the same combined total — no "first one
		// keeps only its own count" asymmetry.
		expect(result.get(1)).toBe(10);
		expect(result.get(2)).toBe(10);
	});

	it('is independent of row order', () => {
		const rowsInReverse = [
			row(2, 'https://example.com/blog/index.html'),
			row(1, 'https://example.com/blog/'),
		];
		const counts = new Map([
			[1, 3],
			[2, 7],
		]);
		const result = computeDirIndexInboundLinkCountByPageId(rowsInReverse, counts);
		expect(result.get(1)).toBe(10);
		expect(result.get(2)).toBe(10);
	});

	it('treats a missing inbound-link-count entry as 0', () => {
		const rows = [
			row(1, 'https://example.com/blog/'),
			row(2, 'https://example.com/blog/index.html'),
		];
		const counts = new Map([[1, 4]]);
		const result = computeDirIndexInboundLinkCountByPageId(rows, counts);
		expect(result.get(1)).toBe(4);
		expect(result.get(2)).toBe(4);
	});

	it('does not add an entry for non-index pages', () => {
		const rows = [row(1, 'https://example.com/about')];
		const counts = new Map([[1, 9]]);
		const result = computeDirIndexInboundLinkCountByPageId(rows, counts);
		expect(result.has(1)).toBe(false);
	});

	it('keeps the same path independent across different origins in a multi-root archive', () => {
		const rows = [
			row(1, 'https://site-a.example/blog/'),
			row(2, 'https://site-b.example/blog/'),
		];
		const counts = new Map([
			[1, 3],
			[2, 8],
		]);
		const result = computeDirIndexInboundLinkCountByPageId(rows, counts);
		expect(result.get(1)).toBe(3);
		expect(result.get(2)).toBe(8);
	});

	it('keeps different directories independent', () => {
		const rows = [
			row(1, 'https://example.com/blog/'),
			row(2, 'https://example.com/docs/'),
		];
		const counts = new Map([
			[1, 3],
			[2, 8],
		]);
		const result = computeDirIndexInboundLinkCountByPageId(rows, counts);
		expect(result.get(1)).toBe(3);
		expect(result.get(2)).toBe(8);
	});

	it('gives the same result from precomputed directory keys, without reading the URLs again', () => {
		const rows = [
			row(1, 'https://example.com/blog/'),
			row(2, 'https://example.com/blog/index.html'),
			row(3, 'https://example.com/docs/'),
		];
		const counts = new Map([
			[1, 2],
			[2, 5],
			[3, 1],
		]);
		const dirKeys = computePageDirKeys(rows);
		// The keys are all that is read: URLs that would not parse change nothing.
		const unparseable = rows.map((r) => row(r.id, 'not a url'));
		// /blog/ and /blog/index.html share a directory: 2 + 5 = 7 for both;
		// /docs/ is alone with 1.
		expect(computeDirIndexInboundLinkCountByPageId(unparseable, counts, dirKeys)).toEqual(
			new Map([
				[1, 7],
				[2, 7],
				[3, 1],
			]),
		);
	});

	it('reads counts from a dense counter the same way as from a map', () => {
		const rows = [
			row(1, 'https://example.com/blog/'),
			row(2, 'https://example.com/blog/index.html'),
		];
		const dense = new DensePageCounts(10);
		dense.increment(1);
		dense.increment(2);
		dense.increment(2);
		const result = computeDirIndexInboundLinkCountByPageId(rows, dense);
		expect(result.get(1)).toBe(3);
		expect(result.get(2)).toBe(3);
	});
});
