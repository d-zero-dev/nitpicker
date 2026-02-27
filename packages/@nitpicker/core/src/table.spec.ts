import { describe, it, expect } from 'vitest';

import { Table } from './table.js';

describe('Table', () => {
	it('starts with empty headers and data', () => {
		const table = new Table<'a'>();
		const json = table.toJSON();
		expect(json.headers).toEqual({});
		expect(json.data).toEqual({});
	});

	it('addHeaders registers column headers', () => {
		const table = new Table<'title' | 'score'>();
		table.addHeaders({ title: 'Page Title', score: 'Score' });
		const json = table.toJSON();
		expect(json.headers).toEqual({ title: 'Page Title', score: 'Score' });
	});

	it('addHeaders merges headers from multiple calls', () => {
		const table = new Table<'a' | 'b'>();
		table.addHeaders({ a: 'A' } as Record<'a' | 'b', string>);
		table.addHeaders({ b: 'B' } as Record<'a' | 'b', string>);
		const json = table.toJSON();
		expect(json.headers).toEqual({ a: 'A', b: 'B' });
	});

	it('addHeaders overwrites duplicate keys with the later value', () => {
		const table = new Table<'x'>();
		table.addHeaders({ x: 'First' });
		table.addHeaders({ x: 'Second' });
		expect(table.toJSON().headers).toEqual({ x: 'Second' });
	});

	it('addDataToUrl stores data for a URL', () => {
		const table = new Table<'col'>();
		const url = { href: 'https://example.com/' } as { href: string };
		table.addDataToUrl(url, { col: { value: 'hello' } });
		const json = table.toJSON();
		expect(json.data['https://example.com/']).toEqual({ col: { value: 'hello' } });
	});

	it('addDataToUrl merges data for the same URL', () => {
		const table = new Table<'a' | 'b'>();
		const url = { href: 'https://example.com/' } as { href: string };
		table.addDataToUrl(url, { a: { value: 1 } } as Record<'a' | 'b', { value: unknown }>);
		table.addDataToUrl(url, { b: { value: 2 } } as Record<'a' | 'b', { value: unknown }>);
		const data = table.toJSON().data['https://example.com/'];
		expect(data).toEqual({ a: { value: 1 }, b: { value: 2 } });
	});

	it('addData stores batch data', () => {
		const table = new Table<'col'>();
		table.addData({
			'https://a.com/': { col: { value: 'A' } },
			'https://b.com/': { col: { value: 'B' } },
		});
		const json = table.toJSON();
		expect(Object.keys(json.data)).toHaveLength(2);
		expect(json.data['https://a.com/']).toEqual({ col: { value: 'A' } });
	});

	it('getData returns data as a plain object', () => {
		const table = new Table<'col'>();
		const url = { href: 'https://example.com/' } as { href: string };
		table.addDataToUrl(url, { col: { value: 42 } });
		const data = table.getData();
		expect(data['https://example.com/']).toEqual({ col: { value: 42 } });
	});

	it('getDataByUrl returns data for a known URL', () => {
		const table = new Table<'col'>();
		const url = { href: 'https://example.com/' } as { href: string };
		table.addDataToUrl(url, { col: { value: 'x' } });
		expect(table.getDataByUrl(url)).toEqual({ col: { value: 'x' } });
	});

	it('getDataByUrl returns undefined for unknown URL', () => {
		const table = new Table<'col'>();
		const url = { href: 'https://unknown.com/' } as { href: string };
		expect(table.getDataByUrl(url)).toBeUndefined();
	});
});
