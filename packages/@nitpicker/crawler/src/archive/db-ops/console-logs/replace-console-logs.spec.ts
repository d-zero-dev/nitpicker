import type { ConsoleLogEntry } from '@d-zero/beholder';
import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';
import { createWriteRefCaches } from '../_shared/create-write-ref-caches.js';
import { resolveContentItemId } from '../_shared/resolve-content-item-id.js';

import { replaceConsoleLogs } from './replace-console-logs.js';

/**
 * Builds a minimal `ConsoleLogEntry` for a plain `console` message.
 * @param overrides - Fields to override on top of the default `log` shape.
 */
function makeEntry(overrides: Partial<ConsoleLogEntry> = {}): ConsoleLogEntry {
	return {
		pageUrl: 'https://example.com/a',
		type: 'log',
		text: 'hello',
		args: [],
		ts: 1000,
		...overrides,
	};
}

describe('replaceConsoleLogs', () => {
	let db: Knex;

	beforeEach(async () => {
		db = knex({
			client: LibsqlDialect,
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
		});
		await createRefTables(db);
		await createEntityTables(db);
		await createAdjunctTables(db);
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('inserts one page_console_logs row per entry', async () => {
		const caches = createWriteRefCaches();
		await replaceConsoleLogs(
			db,
			caches,
			'https://example.com/a',
			[],
			[makeEntry({ text: 'first' }), makeEntry({ text: 'second' })],
		);
		const pageId = await resolveContentItemId(db, caches, 'https://example.com/a');
		const rows = await db('page_console_logs').where('pageId', pageId).select('*');
		expect(rows).toHaveLength(2);
	});

	it('dedupes identical content into one console_log_items row across two pages', async () => {
		const caches = createWriteRefCaches();
		const entry = makeEntry({ text: 'shared warning', type: 'warn' });
		await replaceConsoleLogs(db, caches, 'https://example.com/a', [], [entry]);
		await replaceConsoleLogs(db, caches, 'https://example.com/b', [], [entry]);

		const items = await db('console_log_items').select('id');
		expect(items).toHaveLength(1);
		const edges = await db('page_console_logs').select('pageId');
		expect(edges).toHaveLength(2);
	});

	it('attaches rows to the entry timestamp, preserving one row per occurrence', async () => {
		const caches = createWriteRefCaches();
		const entry = makeEntry({ text: 'repeated' });
		await replaceConsoleLogs(
			db,
			caches,
			'https://example.com/a',
			[],
			[
				{ ...entry, ts: 1 },
				{ ...entry, ts: 2 },
				{ ...entry, ts: 3 },
			],
		);
		const pageId = await resolveContentItemId(db, caches, 'https://example.com/a');
		const rows = await db('page_console_logs')
			.where('pageId', pageId)
			.orderBy('ts')
			.select('ts');
		expect(rows.map((r) => r.ts)).toEqual([1, 2, 3]);
	});

	it('replaces (does not accumulate) rows on a second call for the same page', async () => {
		const caches = createWriteRefCaches();
		await replaceConsoleLogs(
			db,
			caches,
			'https://example.com/a',
			[],
			[makeEntry({ text: 'first' }), makeEntry({ text: 'second' })],
		);
		await replaceConsoleLogs(
			db,
			caches,
			'https://example.com/a',
			[],
			[makeEntry({ text: 'only' })],
		);
		const pageId = await resolveContentItemId(db, caches, 'https://example.com/a');
		const rows = await db('page_console_logs').where('pageId', pageId).select('*');
		expect(rows).toHaveLength(1);
	});

	it('attaches rows to the redirect destination, not the originating URL', async () => {
		const caches = createWriteRefCaches();
		await replaceConsoleLogs(
			db,
			caches,
			'https://example.com/old',
			['https://example.com/old', 'https://example.com/new'],
			[makeEntry()],
		);
		const destId = await resolveContentItemId(db, caches, 'https://example.com/new');
		const sourceId = await resolveContentItemId(db, caches, 'https://example.com/old');
		const destRows = await db('page_console_logs').where('pageId', destId).select('*');
		const sourceRows = await db('page_console_logs')
			.where('pageId', sourceId)
			.select('*');
		expect(destRows).toHaveLength(1);
		expect(sourceRows).toHaveLength(0);
	});

	it('stores args via json_refs and location via url_refs when present', async () => {
		const caches = createWriteRefCaches();
		await replaceConsoleLogs(
			db,
			caches,
			'https://example.com/a',
			[],
			[
				makeEntry({
					text: 'with args',
					args: [1, 'two'],
					location: {
						url: 'https://example.com/app.js',
						lineNumber: 10,
						columnNumber: 5,
					},
				}),
			],
		);
		const [item] = await db('console_log_items').select('*');
		expect(item?.args_json_id).not.toBeNull();
		expect(item?.loc_url_id).not.toBeNull();
		expect(item?.loc_line).toBe(10);
		expect(item?.loc_column).toBe(5);

		const [jsonRow] = await db('json_refs').where('id', item?.args_json_id).select('*');
		const { zstdDecompressSync } = await import('node:zlib');
		expect(zstdDecompressSync(jsonRow?.json_text).toString('utf8')).toBe(
			JSON.stringify([1, 'two']),
		);
	});

	it('stores a pageerror entry with a stack trace and no args', async () => {
		const caches = createWriteRefCaches();
		await replaceConsoleLogs(
			db,
			caches,
			'https://example.com/a',
			[],
			[
				makeEntry({
					type: 'pageerror',
					text: 'Uncaught TypeError: boom',
					args: [],
					stack: 'TypeError: boom\n    at app.js:1:1',
				}),
			],
		);
		const [item] = await db('console_log_items').select('*');
		expect(item?.type).toBe('pageerror');
		expect(item?.args_json_id).toBeNull();
		expect(item?.stack_text_id).not.toBeNull();
		const [stackText] = await db('text_refs')
			.where('id', item?.stack_text_id)
			.select('text');
		expect(stackText?.text).toBe('TypeError: boom\n    at app.js:1:1');
	});

	it('denormalises the error+pageerror count onto page_meta.console_error_count', async () => {
		const caches = createWriteRefCaches();
		const pageId = await resolveContentItemId(db, caches, 'https://example.com/a');
		await db('page_meta').insert({ page_id: pageId });

		await replaceConsoleLogs(
			db,
			caches,
			'https://example.com/a',
			[],
			[
				makeEntry({ type: 'error', text: 'e1' }),
				makeEntry({ type: 'pageerror', text: 'e2' }),
				makeEntry({ type: 'warn', text: 'w1' }),
				makeEntry({ type: 'log', text: 'l1' }),
			],
		);

		const [row] = await db('page_meta')
			.where('page_id', pageId)
			.select('console_error_count');
		expect(row?.console_error_count).toBe(2);
	});

	it('does not throw when page_meta has no row for the page yet', async () => {
		const caches = createWriteRefCaches();
		await expect(
			replaceConsoleLogs(
				db,
				caches,
				'https://example.com/no-page-meta',
				[],
				[makeEntry({ type: 'error' })],
			),
		).resolves.toBeUndefined();
	});

	it('stores a null text_id for an empty-string console.log() call instead of throwing', async () => {
		const caches = createWriteRefCaches();
		await expect(
			replaceConsoleLogs(
				db,
				caches,
				'https://example.com/a',
				[],
				[makeEntry({ text: '', args: [] })],
			),
		).resolves.toBeUndefined();

		const [item] = await db('console_log_items').select('*');
		expect(item?.text_id).toBeNull();
		const pageId = await resolveContentItemId(db, caches, 'https://example.com/a');
		const rows = await db('page_console_logs').where('pageId', pageId).select('*');
		expect(rows).toHaveLength(1);
	});

	it('clears the write ref caches when the transaction fails, so a retry cannot reuse rolled-back ids', async () => {
		const caches = createWriteRefCaches();
		// Dropped after the caches would otherwise have been warmed by
		// `resolveContentItemId` / `upsertUrlRef` / `upsertJsonRef`, so the
		// upsert into `console_log_items` is what fails mid-transaction —
		// matching `record-redirect.spec.ts`'s schema-corruption technique.
		await db.schema.dropTable('console_log_items');
		await expect(
			replaceConsoleLogs(
				db,
				caches,
				'https://example.com/a',
				[],
				[
					makeEntry({
						text: 'boom',
						args: [1],
						location: {
							url: 'https://example.com/app.js',
							lineNumber: 1,
							columnNumber: 1,
						},
					}),
				],
			),
		).rejects.toThrow();
		expect(caches.contentItems.size).toBe(0);
		expect(caches.urlIds.size).toBe(0);
		expect(caches.jsonIds.size).toBe(0);
		expect(caches.consoleLogIds.size).toBe(0);
	});
});
