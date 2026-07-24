import knex from 'knex';
import { describe, it, expect } from 'vitest';

import { createEntityTables } from './create-entity-tables.js';
import { createRefTables } from './create-ref-tables.js';
import { LibsqlDialect } from './libsql-dialect.js';

/**
 * Creates the 0.13 ref tables that the entity tables reference, then runs
 * the entity-table DDL against a fresh in-memory database.
 * @param options - `foreignKeys: true` enables `PRAGMA foreign_keys = ON`
 *   before the caller runs INSERTs (required for any test that exercises
 *   FK / CASCADE / DEFERRABLE / CHECK behaviour).
 * @param options.foreignKeys
 * @returns The knex instance; the caller MUST call `db.destroy()`.
 */
async function openDbWithEntityTables(
	options: { foreignKeys?: boolean } = {},
): Promise<ReturnType<typeof knex>> {
	const db = knex({
		client: LibsqlDialect,
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
	});
	if (options.foreignKeys) {
		await db.raw('PRAGMA foreign_keys = ON');
	}
	await createRefTables(db);
	await createEntityTables(db);
	return db;
}

/**
 * Inserts one `url_refs` row and returns its id, so downstream FK-bearing
 * INSERTs have a legal target.
 * @param db - Knex instance connected to a fresh DB with ref + entity DDL applied.
 * @param url - URL to insert; must be unique per db.
 * @returns The rowid of the inserted `url_refs` row.
 */
async function insertUrl(db: ReturnType<typeof knex>, url: string): Promise<number> {
	const [row] = await db.raw('INSERT INTO url_refs (url) VALUES (?) RETURNING id', [url]);
	return row.id;
}

/**
 * Inserts one `text_refs` row for use as an FK target (image_items.dom_path_text_id
 * is NOT NULL and page_meta text FKs are exercised in some tests).
 * @param db - Knex instance connected to a fresh DB with ref + entity DDL applied.
 * @param hash - 16-byte hash placeholder.
 * @param text - Text body.
 * @returns The rowid of the inserted `text_refs` row.
 */
async function insertText(
	db: ReturnType<typeof knex>,
	hash: Buffer,
	text: string,
): Promise<number> {
	const [row] = await db.raw(
		'INSERT INTO text_refs (hash, text) VALUES (?, ?) RETURNING id',
		[hash, text],
	);
	return row.id;
}

/**
 * Inserts a minimal `content_items` row (id 1) so tests that need a valid
 * `page_id` FK target for `page_meta` / `anchor_edges` / `image_items` /
 * `resource_ref_edges` have one to point at.
 * @param db - Knex instance with FK enabled.
 * @param id - Explicit id to insert.
 * @param urlSuffix - Distinguishes URLs across multiple content_items rows.
 */
async function insertContentItem(
	db: ReturnType<typeof knex>,
	id: number,
	urlSuffix: string,
): Promise<void> {
	const urlId = await insertUrl(db, `https://example.com/${urlSuffix}`);
	await db.raw(
		`INSERT INTO content_items
			(id, url_id, is_external, scraped, is_target)
			VALUES (?, ?, 0, 1, 1)`,
		[id, urlId],
	);
}

describe('createEntityTables', () => {
	it('creates content_items with the expected columns', async () => {
		const db = await openDbWithEntityTables();

		const columns = await db.raw("PRAGMA table_info('content_items')");
		const names = columns.map((c: { name: string }) => c.name);
		expect(names).toEqual([
			'id',
			'url_id',
			'is_external',
			'scraped',
			'is_target',
			'status',
			'status_text',
			'content_type_id',
			'content_length',
			'header_set_id',
			'redirect_dest_id',
			'source',
			'first_crawled_at',
			'last_crawled_at',
			'crawl_order',
			'is_skipped',
			'skip_reason',
		]);

		await db.destroy();
	});

	it('declares content_items.id as INTEGER PRIMARY KEY AUTOINCREMENT (matches legacy pages contract)', async () => {
		const db = await openDbWithEntityTables();

		const [{ sql }] = await db.raw(
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='content_items'",
		);
		expect(sql).toMatch(/AUTOINCREMENT/i);

		// resource_items / anchor_edges / image_items must also match.
		for (const table of ['resource_items', 'anchor_edges', 'image_items']) {
			const [row] = await db.raw(
				`SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}'`,
			);
			expect(row.sql, `${table} should use AUTOINCREMENT`).toMatch(/AUTOINCREMENT/i);
		}

		await db.destroy();
	});

	it('enforces UNIQUE(url_id) on content_items and resource_items', async () => {
		const db = await openDbWithEntityTables({ foreignKeys: true });

		const urlIdA = await insertUrl(db, 'https://example.com/a');
		await db.raw(
			`INSERT INTO content_items
				(id, url_id, is_external, scraped, is_target)
				VALUES (1, ?, 0, 1, 1)`,
			[urlIdA],
		);
		await expect(
			db.raw(
				`INSERT INTO content_items
					(id, url_id, is_external, scraped, is_target)
					VALUES (2, ?, 0, 1, 1)`,
				[urlIdA],
			),
		).rejects.toThrow();

		const urlIdB = await insertUrl(db, 'https://example.com/b.js');
		await db.raw(
			'INSERT INTO resource_items (id, url_id, is_external) VALUES (1, ?, 0)',
			[urlIdB],
		);
		await expect(
			db.raw('INSERT INTO resource_items (id, url_id, is_external) VALUES (2, ?, 0)', [
				urlIdB,
			]),
		).rejects.toThrow();

		await db.destroy();
	});

	it("defaults content_items.source and resource_items.source to 'crawled'", async () => {
		const db = await openDbWithEntityTables({ foreignKeys: true });

		const urlIdA = await insertUrl(db, 'https://example.com/');
		await db.raw(
			`INSERT INTO content_items
				(id, url_id, is_external, scraped, is_target)
				VALUES (1, ?, 0, 1, 1)`,
			[urlIdA],
		);
		const [ci] = await db.raw('SELECT source FROM content_items WHERE id = 1');
		expect(ci.source).toBe('crawled');

		const urlIdB = await insertUrl(db, 'https://example.com/style.css');
		await db.raw(
			'INSERT INTO resource_items (id, url_id, is_external) VALUES (1, ?, 0)',
			[urlIdB],
		);
		const [ri] = await db.raw('SELECT source FROM resource_items WHERE id = 1');
		expect(ri.source).toBe('crawled');

		await db.destroy();
	});

	it('accepts a self-referential redirect_dest_id on content_items', async () => {
		const db = await openDbWithEntityTables({ foreignKeys: true });

		await insertContentItem(db, 1, 'a');
		const urlIdB = await insertUrl(db, 'https://example.com/b');
		await db.raw(
			`INSERT INTO content_items
				(id, url_id, is_external, scraped, is_target, redirect_dest_id)
				VALUES (2, ?, 0, 1, 1, 1)`,
			[urlIdB],
		);

		// A non-existent destination is still rejected at commit time.
		await expect(
			(async () => {
				const urlIdC = await insertUrl(db, 'https://example.com/c');
				await db.raw(
					`INSERT INTO content_items
						(id, url_id, is_external, scraped, is_target, redirect_dest_id)
						VALUES (3, ?, 0, 1, 1, 999)`,
					[urlIdC],
				);
			})(),
		).rejects.toThrow();

		await db.destroy();
	});

	it('allows deferring content_items.redirect_dest_id inside a transaction', async () => {
		const db = await openDbWithEntityTables({ foreignKeys: true });

		// The forward reference (child inserted before parent) is legal
		// because the FK is DEFERRABLE INITIALLY DEFERRED and both inserts
		// live inside one transaction.
		const urlIdChild = await insertUrl(db, 'https://example.com/child');
		const urlIdParent = await insertUrl(db, 'https://example.com/parent');

		await db.transaction(async (trx) => {
			await trx.raw(
				`INSERT INTO content_items
					(id, url_id, is_external, scraped, is_target, redirect_dest_id)
					VALUES (10, ?, 0, 1, 1, 20)`,
				[urlIdChild],
			);
			await trx.raw(
				`INSERT INTO content_items
					(id, url_id, is_external, scraped, is_target)
					VALUES (20, ?, 0, 1, 1)`,
				[urlIdParent],
			);
		});

		await db.destroy();
	});

	it('creates page_meta keyed by page_id 1:1 with content_items and CASCADE deletes', async () => {
		const db = await openDbWithEntityTables({ foreignKeys: true });

		await insertContentItem(db, 1, 'a');
		await db.raw('INSERT INTO page_meta (page_id, lang) VALUES (1, ?)', ['ja']);

		// PK uniqueness: a second row with page_id=1 is rejected.
		await expect(
			db.raw('INSERT INTO page_meta (page_id, lang) VALUES (1, ?)', ['en']),
		).rejects.toThrow();

		// FK: page_id=999 has no matching content_items row.
		await expect(
			db.raw('INSERT INTO page_meta (page_id) VALUES (999)'),
		).rejects.toThrow();

		// CASCADE: deleting the content_items parent must also drop the
		// page_meta child.
		await db.raw('DELETE FROM content_items WHERE id = 1');
		const [{ n }] = await db.raw('SELECT COUNT(*) AS n FROM page_meta WHERE page_id = 1');
		expect(n).toBe(0);

		await db.destroy();
	});

	it('creates resource_items with the expected columns', async () => {
		const db = await openDbWithEntityTables();

		const columns = await db.raw("PRAGMA table_info('resource_items')");
		const names = columns.map((c: { name: string }) => c.name);
		expect(names).toEqual([
			'id',
			'url_id',
			'url_blob_id',
			'is_external',
			'status',
			'status_text',
			'content_type_id',
			'content_length',
			'header_set_id',
			'compress',
			'cdn',
			'source',
		]);

		await db.destroy();
	});

	it('enforces UNIQUE(page_id, href_page_id) on anchor_edges', async () => {
		const db = await openDbWithEntityTables({ foreignKeys: true });

		await insertContentItem(db, 1, 'source');
		await insertContentItem(db, 2, 'dest');

		await db.raw(
			'INSERT INTO anchor_edges (page_id, href_page_id, count) VALUES (1, 2, 1)',
		);
		// Same pair — must be rejected even with a different count.
		await expect(
			db.raw('INSERT INTO anchor_edges (page_id, href_page_id, count) VALUES (1, 2, 3)'),
		).rejects.toThrow();

		// Confirm the UNIQUE targets the (page_id, href_page_id) pair
		// specifically (not, say, `id` alone which would also satisfy
		// "at least one unique index exists" on a PK-only shape).
		const indexes: { name: string; unique: number }[] = await db.raw(
			"PRAGMA index_list('anchor_edges')",
		);
		const uniqueIndexes = indexes.filter((i) => i.unique === 1);
		let pairIndexFound = false;
		for (const idx of uniqueIndexes) {
			const info: { name: string }[] = await db.raw(`PRAGMA index_info('${idx.name}')`);
			const cols = info.map((c) => c.name);
			if (cols.length === 2 && cols[0] === 'page_id' && cols[1] === 'href_page_id') {
				pairIndexFound = true;
				break;
			}
		}
		expect(pairIndexFound).toBe(true);

		await db.destroy();
	});

	it('creates resource_ref_edges as WITHOUT ROWID with composite PK and page_id index', async () => {
		const db = await openDbWithEntityTables({ foreignKeys: true });

		const [{ sql }] = await db.raw(
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='resource_ref_edges'",
		);
		expect(sql).toMatch(/WITHOUT ROWID/i);

		await insertContentItem(db, 1, 'page');
		const urlIdRes = await insertUrl(db, 'https://example.com/asset.js');
		await db.raw(
			'INSERT INTO resource_items (id, url_id, is_external) VALUES (1, ?, 0)',
			[urlIdRes],
		);

		await db.raw(
			'INSERT INTO resource_ref_edges (resource_id, page_id, count) VALUES (1, 1, 1)',
		);
		await expect(
			db.raw(
				'INSERT INTO resource_ref_edges (resource_id, page_id, count) VALUES (1, 1, 1)',
			),
		).rejects.toThrow();

		// Reverse-direction lookup by page_id must have its own index,
		// because the composite PK on (resource_id, page_id) can only be
		// prefix-seeked by resource_id.
		const indexes: { name: string }[] = await db.raw(
			"PRAGMA index_list('resource_ref_edges')",
		);
		expect(indexes.some((i) => i.name === 'idx_resource_ref_edges_page')).toBe(true);

		await db.destroy();
	});

	it('defaults resource_ref_edges.count to 1 when omitted', async () => {
		const db = await openDbWithEntityTables({ foreignKeys: true });

		await insertContentItem(db, 1, 'p');
		const urlIdRes = await insertUrl(db, 'https://example.com/x.js');
		await db.raw(
			'INSERT INTO resource_items (id, url_id, is_external) VALUES (1, ?, 0)',
			[urlIdRes],
		);
		await db.raw('INSERT INTO resource_ref_edges (resource_id, page_id) VALUES (1, 1)');
		const [row] = await db.raw(
			'SELECT count FROM resource_ref_edges WHERE resource_id = 1 AND page_id = 1',
		);
		expect(row.count).toBe(1);

		await db.destroy();
	});

	it('creates image_items with dom_path_text_id NOT NULL', async () => {
		const db = await openDbWithEntityTables({ foreignKeys: true });

		const columns = await db.raw("PRAGMA table_info('image_items')");
		const domPath = columns.find(
			(c: { name: string; notnull: number }) => c.name === 'dom_path_text_id',
		);
		expect(domPath).toBeDefined();
		expect(domPath.notnull).toBe(1);

		await insertContentItem(db, 1, 'p');

		await expect(
			db.raw(
				`INSERT INTO image_items
					(id, page_id, width, height, natural_width, natural_height, viewport_width, dom_path_text_id)
					VALUES (1, 1, 0, 0, 0, 0, 0, NULL)`,
			),
		).rejects.toThrow();

		const domPathId = await insertText(
			db,
			Buffer.from('aa'.repeat(16), 'hex'),
			'html>body>img',
		);
		await db.raw(
			`INSERT INTO image_items
				(id, page_id, width, height, natural_width, natural_height, viewport_width, dom_path_text_id)
				VALUES (1, 1, 0, 0, 0, 0, 0, ?)`,
			[domPathId],
		);

		await db.destroy();
	});

	it('permits image_items dimensional columns to be NULL', async () => {
		// width / height / natural_width / natural_height /
		// viewport_width are intentionally nullable — a deliberate
		// divergence from legacy `images`,
		// which declared them `.notNullable()`. Documenting the
		// divergence with a passing NULL insert prevents a future
		// "restore the legacy NOT NULL contract" edit from silently
		// re-tightening the schema.
		const db = await openDbWithEntityTables({ foreignKeys: true });

		await insertContentItem(db, 1, 'p');
		const domPathId = await insertText(
			db,
			Buffer.from('bb'.repeat(16), 'hex'),
			'html>body>img',
		);
		await db.raw(
			`INSERT INTO image_items
				(id, page_id, dom_path_text_id)
				VALUES (1, 1, ?)`,
			[domPathId],
		);
		const [row] = await db.raw(
			'SELECT width, height, natural_width, natural_height, viewport_width FROM image_items WHERE id = 1',
		);
		expect(row.width).toBeNull();
		expect(row.height).toBeNull();
		expect(row.natural_width).toBeNull();
		expect(row.natural_height).toBeNull();
		expect(row.viewport_width).toBeNull();

		await db.destroy();
	});

	it('enforces image_items src/blob mutual-exclusion via CHECK', async () => {
		const db = await openDbWithEntityTables({ foreignKeys: true });

		await insertContentItem(db, 1, 'p');
		const domPathId = await insertText(
			db,
			Buffer.from('cc'.repeat(16), 'hex'),
			'html>body>img',
		);
		const urlIdSrc = await insertUrl(db, 'https://example.com/pic.png');
		const [blobRow] = await db.raw(
			`INSERT INTO blob_refs (hash, body, codec, size_raw, size_stored)
				VALUES (?, ?, 'none', ?, ?) RETURNING id`,
			[Buffer.from('dd'.repeat(16), 'hex'), Buffer.from('body'), 4, 4],
		);
		const blobId = blobRow.id;

		// Both url and blob for src → rejected.
		await expect(
			db.raw(
				`INSERT INTO image_items
					(id, page_id, src_url_id, src_blob_id, dom_path_text_id)
					VALUES (1, 1, ?, ?, ?)`,
				[urlIdSrc, blobId, domPathId],
			),
		).rejects.toThrow();

		// Both url and blob for currentSrc → rejected.
		await expect(
			db.raw(
				`INSERT INTO image_items
					(id, page_id, current_src_url_id, current_src_blob_id, dom_path_text_id)
					VALUES (1, 1, ?, ?, ?)`,
				[urlIdSrc, blobId, domPathId],
			),
		).rejects.toThrow();

		// url-only, blob-only, and both-null combinations all pass.
		await db.raw(
			`INSERT INTO image_items
				(id, page_id, src_url_id, dom_path_text_id)
				VALUES (10, 1, ?, ?)`,
			[urlIdSrc, domPathId],
		);
		await db.raw(
			`INSERT INTO image_items
				(id, page_id, src_blob_id, dom_path_text_id)
				VALUES (11, 1, ?, ?)`,
			[blobId, domPathId],
		);
		await db.raw(
			`INSERT INTO image_items
				(id, page_id, dom_path_text_id)
				VALUES (12, 1, ?)`,
			[domPathId],
		);

		await db.destroy();
	});

	it('creates every secondary index required by legacy hot paths', async () => {
		const db = await openDbWithEntityTables();

		const contentIndexes: { name: string }[] = await db.raw(
			"PRAGMA index_list('content_items')",
		);
		const contentIndexNames = contentIndexes.map((i) => i.name);
		expect(contentIndexNames).toContain('idx_content_items_external');
		expect(contentIndexNames).toContain('idx_content_items_scraped');
		expect(contentIndexNames).toContain('idx_content_items_redirect_dest_id');
		expect(contentIndexNames).toContain('idx_content_items_content_type_id');
		expect(contentIndexNames).toContain('idx_content_items_crawl_order');
		expect(contentIndexNames).toContain('idx_content_items_source');

		const pageMetaIndexes: { name: string }[] = await db.raw(
			"PRAGMA index_list('page_meta')",
		);
		const pageMetaIndexNames = pageMetaIndexes.map((i) => i.name);
		expect(pageMetaIndexNames).toContain('idx_page_meta_og_type');
		expect(pageMetaIndexNames).toContain('idx_page_meta_robots_noindex');

		const resourceIndexes: { name: string }[] = await db.raw(
			"PRAGMA index_list('resource_items')",
		);
		expect(resourceIndexes.map((i) => i.name)).toContain('idx_resource_items_source');

		const anchorIndexes: { name: string }[] = await db.raw(
			"PRAGMA index_list('anchor_edges')",
		);
		expect(anchorIndexes.map((i) => i.name)).toContain('idx_anchor_edges_href');

		const imageIndexes: { name: string }[] = await db.raw(
			"PRAGMA index_list('image_items')",
		);
		expect(imageIndexes.map((i) => i.name)).toContain('idx_image_items_page');

		await db.destroy();
	});

	it('is idempotent when called twice against the same DB', async () => {
		const db = await openDbWithEntityTables();
		// Second call must not throw ("table already exists") because
		// the DDL uses CREATE TABLE IF NOT EXISTS throughout.
		await createEntityTables(db);
		await db.destroy();
	});

	it('does not throw when page_meta pre-exists without body_hash (legacy archive on open)', async () => {
		const db = await openDbWithEntityTables();
		// Simulate a legacy `page_meta` that predates the `body_hash` column
		// by dropping just that one column from the otherwise-current shape
		// (keeping every other column/index-backing column intact, so this
		// exercises exactly the `body_hash` gap and nothing else).
		// `createEntityTables` runs unconditionally on every archive open —
		// including this one, before `migratePageMetaBodyHash` ever gets a
		// chance to add the column back — so it must never reference
		// `body_hash` in a way that requires the column to already exist
		// (regression guard: an earlier version of this DDL created
		// `idx_page_meta_body_hash` here unconditionally, which raised
		// `no such column: body_hash` against exactly this shape).
		await db.schema.alterTable('page_meta', (t) => {
			t.dropColumn('body_hash');
		});
		expect(await db.schema.hasColumn('page_meta', 'body_hash')).toBe(false);

		await expect(createEntityTables(db)).resolves.toBeUndefined();

		await db.destroy();
	});

	it('re-creates missing tables when only some 0.13 tables exist (partial-corruption repair)', async () => {
		const db = await openDbWithEntityTables();

		// Simulate an external repair pass that dropped `page_meta`
		// while leaving `content_items` in place. On next open the
		// primitive must recreate the missing table without erroring on
		// the still-present `content_items`.
		await db.raw('DROP TABLE page_meta');
		expect(await db.schema.hasTable('page_meta')).toBe(false);
		expect(await db.schema.hasTable('content_items')).toBe(true);

		await createEntityTables(db);

		expect(await db.schema.hasTable('page_meta')).toBe(true);
		expect(await db.schema.hasTable('content_items')).toBe(true);

		await db.destroy();
	});
});
