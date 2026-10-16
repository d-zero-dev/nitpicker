import type { IsolatedComponent } from '../types.js';

import { describe, it, expect } from 'vitest';

import { buildIsolatedReadModelRows } from './build-isolated-read-model-rows.js';

const SEED = 'inventory-seed' as const;
const DISCOVERED = 'inventory-discovered' as const;

const COMPONENTS: IsolatedComponent[] = [
	{
		representativeUrl: 'https://example.com/a',
		members: [
			{ url: 'https://example.com/a', title: 'A', status: 200, source: SEED },
			{ url: 'https://example.com/b', title: null, status: null, source: DISCOVERED },
		],
		size: 2,
	},
	{
		representativeUrl: 'https://example.com/c',
		members: [{ url: 'https://example.com/c', title: 'C', status: 404, source: SEED }],
		size: 1,
	},
];

const PAGE_IDS = new Map([
	['https://example.com/a', 10],
	['https://example.com/b', 20],
	['https://example.com/c', 30],
]);

describe('buildIsolatedReadModelRows', () => {
	it('numbers the components from 1 in the order they are given', () => {
		const { components } = buildIsolatedReadModelRows(COMPONENTS, PAGE_IDS);
		expect(
			components.map((row) => [row.component_id, row.representative_url]),
		).toStrictEqual([
			[1, 'https://example.com/a'],
			[2, 'https://example.com/c'],
		]);
	});

	it('writes a component row from its first member, with the size and its descending key', () => {
		const { components } = buildIsolatedReadModelRows(COMPONENTS, PAGE_IDS);
		expect(components[0]).toStrictEqual({
			component_id: 1,
			representative_url: 'https://example.com/a',
			representative_title: 'A',
			representative_status: 200,
			representative_url_sort_key: 'https://example.com/a',
			representative_title_sort_key: 'A',
			representative_status_sort_key: 200,
			representative_status_desc_key: -200,
			size: 2,
			size_desc_key: -2,
		});
	});

	it('gives every member the number of its component and its page id as pages.page_id', () => {
		const { pages } = buildIsolatedReadModelRows(COMPONENTS, PAGE_IDS);
		expect(pages.map((row) => [row.component_id, row.page_id, row.url])).toStrictEqual([
			[1, 10, 'https://example.com/a'],
			[1, 20, 'https://example.com/b'],
			[2, 30, 'https://example.com/c'],
		]);
	});

	it('sorts a member with no title or status as an empty title and the null-status sentinel', () => {
		const { pages } = buildIsolatedReadModelRows(COMPONENTS, PAGE_IDS);
		expect(pages[1]).toMatchObject({
			title: null,
			title_sort_key: '',
			status: null,
			source: 'inventory-discovered',
		});
		expect(pages[1]!.status_desc_key).toBe(-pages[1]!.status_sort_key);
	});

	it('skips a member whose page id is unknown, keeping the numbering of the others', () => {
		const { components, pages } = buildIsolatedReadModelRows(
			COMPONENTS,
			new Map([['https://example.com/c', 30]]),
		);
		expect(components.map((row) => row.component_id)).toStrictEqual([1, 2]);
		expect(pages.map((row) => [row.component_id, row.page_id])).toStrictEqual([[2, 30]]);
	});

	it('writes no rows for no components', () => {
		expect(buildIsolatedReadModelRows([], PAGE_IDS)).toStrictEqual({
			components: [],
			pages: [],
		});
	});
});
