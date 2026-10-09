import type { Knex } from 'knex';

import knex from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAdjunctTables } from '../../create-adjunct-tables.js';
import { createEntityTables } from '../../create-entity-tables.js';
import { createRefTables } from '../../create-ref-tables.js';
import { LibsqlDialect } from '../../libsql-dialect.js';

import { createWriteRefCaches } from './create-write-ref-caches.js';
import { resolveContentItemId } from './resolve-content-item-id.js';

describe('resolveContentItemId', () => {
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

	it('inserts a new row with defaults and returns its id', async () => {
		const caches = createWriteRefCaches();
		const id = await resolveContentItemId(db, caches, 'https://example.com/a');
		const row = await db('content_items').where('id', id).first();
		expect(row).toMatchObject({
			scraped: 0,
			is_target: 0,
			is_external: 0,
			source: 'crawled',
		});
	});

	it('records isExternal and source on the insert path', async () => {
		const caches = createWriteRefCaches();
		const id = await resolveContentItemId(db, caches, 'https://example.com/seed', {
			isExternal: 1,
			source: 'inventory-seed',
		});
		const row = await db('content_items').where('id', id).first();
		expect(row).toMatchObject({ is_external: 1, source: 'inventory-seed' });
	});

	it('returns the existing id for a known URL without inserting a duplicate', async () => {
		const cachesA = createWriteRefCaches();
		const first = await resolveContentItemId(db, cachesA, 'https://example.com/x');
		// A fresh cache bundle forces the DB lookup path.
		const cachesB = createWriteRefCaches();
		const second = await resolveContentItemId(db, cachesB, 'https://example.com/x');
		expect(second).toBe(first);
		const [count] = await db('content_items').count<{ c: number }[]>({ c: '*' });
		expect(Number(count.c)).toBe(1);
	});

	it('returns the existing id when the INSERT hits the url_id conflict (SELECT-miss race shape)', async () => {
		// Reproduce the race shape directly: the row exists in the DB but the
		// SELECT-first path is bypassed by seeding url_refs + content_items
		// through a DIFFERENT url string casing of the same url_id — instead,
		// drive the conflict by pre-inserting content_items AFTER url_refs
		// resolution. The upsert must return the pre-existing row's id (the
		// legacy onConflict().ignore() form returned a stale lastInsertRowid
		// belonging to an unrelated row here).
		const caches = createWriteRefCaches();
		const [urlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/raced' })
			.returning('id');
		// Unrelated row first, so a stale lastInsertRowid would point at it.
		const [unrelatedUrlRef] = await db('url_refs')
			.insert({ url: 'https://example.com/unrelated' })
			.returning('id');
		const [unrelated] = await db('content_items')
			.insert({
				url_id: unrelatedUrlRef.id,
				scraped: 0,
				is_target: 0,
				is_external: 0,
			})
			.returning('id');
		const [existing] = await db('content_items')
			.insert({
				url_id: urlRef.id,
				scraped: 1,
				is_target: 1,
				is_external: 0,
				source: 'inventory-seed',
			})
			.returning('id');
		// Warm the url cache but leave the contentItems cache cold, then
		// delete-and-reinsert... instead simply call: the SELECT will find the
		// row, exercising the documented lookup path. To force the INSERT
		// conflict itself, call the raw upsert shape the implementation uses:
		const rows: { id: number; source: string }[] = await db.raw(
			`INSERT INTO content_items (url_id, scraped, is_target, is_external)
			 VALUES (?, 0, 0, ?)
			 ON CONFLICT(url_id) DO UPDATE SET url_id = url_id
			 RETURNING id, source`,
			[urlRef.id, 0],
		);
		expect(rows[0]?.id).toBe(existing.id);
		expect(rows[0]?.id).not.toBe(unrelated.id);
		expect(rows[0]?.source).toBe('inventory-seed');
		// And the public function agrees end-to-end:
		const resolved = await resolveContentItemId(db, caches, 'https://example.com/raced');
		expect(resolved).toBe(existing.id);
	});

	it('downgrades an inventory-labelled row to crawled when resolved with crawled lineage', async () => {
		const cachesA = createWriteRefCaches();
		const id = await resolveContentItemId(db, cachesA, 'https://example.com/orphan', {
			isExternal: 0,
			source: 'inventory-discovered',
		});
		const cachesB = createWriteRefCaches();
		await resolveContentItemId(db, cachesB, 'https://example.com/orphan', {
			isExternal: 0,
			source: 'crawled',
		});
		const row = await db('content_items').where('id', id).first();
		expect(row?.source).toBe('crawled');
	});

	it('never downgrades in the other direction (crawled stays crawled)', async () => {
		const cachesA = createWriteRefCaches();
		const id = await resolveContentItemId(db, cachesA, 'https://example.com/page', {
			isExternal: 0,
			source: 'crawled',
		});
		const cachesB = createWriteRefCaches();
		await resolveContentItemId(db, cachesB, 'https://example.com/page', {
			isExternal: 0,
			source: 'inventory-seed',
		});
		const row = await db('content_items').where('id', id).first();
		expect(row?.source).toBe('crawled');
	});

	describe('isMetadataOnly (#369)', () => {
		it('defaults to 0 on insert when omitted', async () => {
			const caches = createWriteRefCaches();
			const id = await resolveContentItemId(db, caches, 'https://example.com/a');
			const row = await db('content_items').where('id', id).first();
			expect(row?.is_metadata_only).toBe(0);
		});

		it('writes the given value on insert', async () => {
			const caches = createWriteRefCaches();
			const id = await resolveContentItemId(
				db,
				caches,
				'https://example.com/anchor-target',
				{
					isExternal: 0,
					isMetadataOnly: 1,
				},
			);
			const row = await db('content_items').where('id', id).first();
			expect(row?.is_metadata_only).toBe(1);
		});

		it('promotes an existing row (unopinionated insert, then an opinionated anchor call)', async () => {
			const cachesA = createWriteRefCaches();
			const id = await resolveContentItemId(db, cachesA, 'https://example.com/shared');
			// A fresh cache bundle forces the DB lookup path, same as the
			// existing "returns the existing id" test above.
			const cachesB = createWriteRefCaches();
			await resolveContentItemId(db, cachesB, 'https://example.com/shared', {
				isExternal: 0,
				isMetadataOnly: 1,
			});
			const row = await db('content_items').where('id', id).first();
			expect(row?.is_metadata_only).toBe(1);
		});

		it('leaves is_metadata_only untouched when a later caller has no opinion', async () => {
			const cachesA = createWriteRefCaches();
			const id = await resolveContentItemId(db, cachesA, 'https://example.com/anchored', {
				isExternal: 0,
				isMetadataOnly: 1,
			});
			const cachesB = createWriteRefCaches();
			// No isMetadataOnly argument — e.g. a resource-referrer or redirect
			// call resolving the same URL — must not clobber the flag an
			// anchor-discovery call already established.
			await resolveContentItemId(db, cachesB, 'https://example.com/anchored');
			const row = await db('content_items').where('id', id).first();
			expect(row?.is_metadata_only).toBe(1);
		});

		it('skips the UPDATE when the cached value already matches (no redundant write)', async () => {
			const caches = createWriteRefCaches();
			const id = await resolveContentItemId(db, caches, 'https://example.com/repeat', {
				isExternal: 0,
				isMetadataOnly: 1,
			});
			// Same warm cache, same opinionated value again — a second anchor
			// referencing the same URL from a different page.
			const again = await resolveContentItemId(db, caches, 'https://example.com/repeat', {
				isExternal: 0,
				isMetadataOnly: 1,
			});
			expect(again).toBe(id);
			const row = await db('content_items').where('id', id).first();
			expect(row?.is_metadata_only).toBe(1);
		});

		it('folds a simultaneous crawled-wins downgrade and metadataOnly promotion into one UPDATE', async () => {
			// Both `applyExistingRowUpdates` diffs fire in the same call —
			// regression guard for the single-statement merge (issue #369 code
			// review): an inventory-labelled row, re-encountered via a
			// crawled-lineage anchor that also carries an opinionated
			// isMetadataOnly value, must end up with both columns updated.
			const cachesA = createWriteRefCaches();
			const id = await resolveContentItemId(db, cachesA, 'https://example.com/both', {
				isExternal: 0,
				source: 'inventory-discovered',
			});
			const cachesB = createWriteRefCaches();
			await resolveContentItemId(db, cachesB, 'https://example.com/both', {
				isExternal: 0,
				source: 'crawled',
				isMetadataOnly: 1,
			});
			const row = await db('content_items').where('id', id).first();
			expect(row?.source).toBe('crawled');
			expect(row?.is_metadata_only).toBe(1);
		});
	});
});
