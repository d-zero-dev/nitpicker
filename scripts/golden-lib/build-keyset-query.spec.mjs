import { describe, it, expect } from 'vitest';

import { buildKeysetQuery } from './build-keyset-query.mjs';

describe('buildKeysetQuery', () => {
	it('reads a rowid table in rowid order, exposing the rowid as __rowid', () => {
		expect(
			buildKeysetQuery({
				table: 'viewer_pages',
				keyColumns: undefined,
				chunkSize: 100,
				afterKey: undefined,
			}),
		).toEqual({
			sql: 'SELECT rowid AS "__rowid", * FROM "viewer_pages" ORDER BY rowid LIMIT ?',
			bindings: [100],
		});
	});

	it('continues a rowid table after the last rowid read', () => {
		expect(
			buildKeysetQuery({
				table: 'viewer_pages',
				keyColumns: undefined,
				chunkSize: 100,
				afterKey: [42],
			}),
		).toEqual({
			sql: 'SELECT rowid AS "__rowid", * FROM "viewer_pages" WHERE rowid > ? ORDER BY rowid LIMIT ?',
			bindings: [42, 100],
		});
	});

	it('reads a WITHOUT ROWID table in primary-key order', () => {
		expect(
			buildKeysetQuery({
				table: 'viewer_graph_edges',
				keyColumns: ['source_page_id', 'target_page_id'],
				chunkSize: 10,
				afterKey: undefined,
			}),
		).toEqual({
			sql: 'SELECT * FROM "viewer_graph_edges" ORDER BY "source_page_id", "target_page_id" LIMIT ?',
			bindings: [10],
		});
	});

	it('continues a composite key with a row-value comparison', () => {
		expect(
			buildKeysetQuery({
				table: 'viewer_graph_edges',
				keyColumns: ['source_page_id', 'target_page_id'],
				chunkSize: 10,
				afterKey: [7, 9],
			}),
		).toEqual({
			sql: 'SELECT * FROM "viewer_graph_edges" WHERE ("source_page_id", "target_page_id") > (?, ?) ORDER BY "source_page_id", "target_page_id" LIMIT ?',
			bindings: [7, 9, 10],
		});
	});

	it('continues a single-column key without a row value', () => {
		expect(
			buildKeysetQuery({
				table: 't',
				keyColumns: ['k'],
				chunkSize: 5,
				afterKey: ['a'],
			}).sql,
		).toBe('SELECT * FROM "t" WHERE "k" > ? ORDER BY "k" LIMIT ?');
	});

	it('escapes double quotes in identifiers', () => {
		expect(
			buildKeysetQuery({
				table: 'we"ird',
				keyColumns: ['c"ol'],
				chunkSize: 1,
				afterKey: undefined,
			}).sql,
		).toBe('SELECT * FROM "we""ird" ORDER BY "c""ol" LIMIT ?');
	});

	it('rejects an afterKey whose length does not match the key columns', () => {
		expect(() =>
			buildKeysetQuery({
				table: 't',
				keyColumns: ['a', 'b'],
				chunkSize: 1,
				afterKey: [1],
			}),
		).toThrow(/afterKey/);
	});
});
