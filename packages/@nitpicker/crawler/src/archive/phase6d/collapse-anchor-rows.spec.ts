import { describe, it, expect } from 'vitest';

import { collapseAnchorRows } from './collapse-anchor-rows.js';

describe('collapseAnchorRows (anchor-edge-normalization)', () => {
	it('collapses repeated (pageId, hrefId) pairs into a single edge with the first row winning', () => {
		const edges = [
			...collapseAnchorRows([
				{ id: 1, pageId: 10, hrefId: 20, hash: 'aaa', textContent: 'first' },
				{ id: 2, pageId: 10, hrefId: 20, hash: 'bbb', textContent: 'second' },
				{ id: 3, pageId: 10, hrefId: 20, hash: 'ccc', textContent: 'third' },
			]),
		];
		expect(edges).toHaveLength(1);
		expect(edges[0]!).toEqual({
			page_id: 10,
			href_page_id: 20,
			count: 3,
			first_hash: 'aaa',
			first_textContent: 'first',
		});
	});

	it('emits distinct edges per (pageId, hrefId) pair in traversal order', () => {
		const edges = [
			...collapseAnchorRows([
				{ id: 1, pageId: 10, hrefId: 20, hash: 'a', textContent: 'a' },
				{ id: 2, pageId: 10, hrefId: 30, hash: 'b', textContent: 'b' },
				{ id: 3, pageId: 11, hrefId: 20, hash: 'c', textContent: 'c' },
			]),
		];
		expect(edges).toEqual([
			{
				page_id: 10,
				href_page_id: 20,
				count: 1,
				first_hash: 'a',
				first_textContent: 'a',
			},
			{
				page_id: 10,
				href_page_id: 30,
				count: 1,
				first_hash: 'b',
				first_textContent: 'b',
			},
			{
				page_id: 11,
				href_page_id: 20,
				count: 1,
				first_hash: 'c',
				first_textContent: 'c',
			},
		]);
	});

	it('preserves null hash / textContent from the first instance', () => {
		const edges = [
			...collapseAnchorRows([
				{ id: 1, pageId: 5, hrefId: 6, hash: null, textContent: null },
				{ id: 2, pageId: 5, hrefId: 6, hash: 'later', textContent: 'later' },
			]),
		];
		expect(edges).toEqual([
			{
				page_id: 5,
				href_page_id: 6,
				count: 2,
				first_hash: null,
				first_textContent: null,
			},
		]);
	});

	it('yields nothing for an empty input', () => {
		expect([...collapseAnchorRows([])]).toEqual([]);
	});

	it('throws when input is not sorted by id within a (pageId, hrefId) group', () => {
		// Regression guard: a caller that drops the `id` tie-breaker from
		// `ORDER BY pageId, hrefId, id` silently loses the "first
		// instance wins" contract. The count-based acceptance check
		// wouldn't catch it (SUM(count) is order-independent), so the
		// collapser defends its own precondition.
		expect(() =>
			[
				...collapseAnchorRows([
					{ id: 5, pageId: 10, hrefId: 20, hash: 'later', textContent: 'later' },
					{ id: 2, pageId: 10, hrefId: 20, hash: 'earlier', textContent: 'earlier' },
				]),
			]
				// force generator evaluation
				.at(0),
		).toThrow(/not sorted by id/);
	});

	it('does not conflate different hrefIds within the same page', () => {
		// Regression guard: a naive "current pair" comparator that only
		// checked pageId would collapse pageId=10 hrefId=20 with the
		// following pageId=10 hrefId=30 into one edge.
		const edges = [
			...collapseAnchorRows([
				{ id: 1, pageId: 10, hrefId: 20, hash: 'x', textContent: 'x' },
				{ id: 2, pageId: 10, hrefId: 30, hash: 'y', textContent: 'y' },
				{ id: 3, pageId: 10, hrefId: 30, hash: 'z', textContent: 'z' },
			]),
		];
		expect(edges).toHaveLength(2);
		expect(edges[0]!.count).toBe(1);
		expect(edges[1]!.count).toBe(2);
	});
});
