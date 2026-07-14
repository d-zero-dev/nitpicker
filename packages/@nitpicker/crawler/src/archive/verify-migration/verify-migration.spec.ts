import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupMigrationDb } from '../populate-entity-tables/test-utils/setup-entities-db.js';
import { populateRefTables } from '../populate-ref-tables/populate-refs.js';

import { MigrationVerificationError } from './types.js';
import { verifyMigration } from './verify-migration.js';

/**
 * Builds a small end-to-end fixture that exercises every populate path
 * (content_items, page_meta, anchor_edges, image_items, resource_items,
 * resource_ref_edges) enough to make the orchestrator's happy-path
 * assertion meaningful. Ref tables are populated via the real 0.13
 * populator so `url_refs.url` matches `pages.url` verbatim (required by
 * check #8's round-trip).
 * @param db - Knex handle from {@link setupMigrationDb}.
 */
async function seedValidArchive(db: ReturnType<typeof knex>): Promise<void> {
	await db('pages').insert([
		{
			id: 1,
			url: 'https://example.com/a',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			contentType: 'text/html; charset=utf-8',
		},
		{
			id: 2,
			url: 'https://example.com/b',
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			contentType: 'text/html; charset=utf-8',
		},
	]);
	await db('resources').insert({
		id: 10,
		url: 'https://cdn.example.com/x.js',
		isExternal: 1,
		contentType: 'application/javascript',
	});
	await db('resources-referrers').insert({ resourceId: 10, pageId: 1 });
	await db('anchors').insert([
		{ pageId: 1, hrefId: 2, hash: 'a', textContent: 'link1' },
		{ pageId: 1, hrefId: 2, hash: 'b', textContent: 'link2' },
	]);
	await populateRefTables(db);
	const urlA = await db('url_refs').where('url', 'https://example.com/a').first();
	const urlB = await db('url_refs').where('url', 'https://example.com/b').first();
	const urlCdn = await db('url_refs')
		.where('url', 'https://cdn.example.com/x.js')
		.first();
	const ctHtml = await db('content_type_refs')
		.where('raw', 'text/html; charset=utf-8')
		.first();
	const ctJs = await db('content_type_refs')
		.where('raw', 'application/javascript')
		.first();
	await db('content_items').insert([
		{
			id: 1,
			url_id: urlA!.id,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			source: 'crawled',
			content_type_id: ctHtml!.id,
		},
		{
			id: 2,
			url_id: urlB!.id,
			is_external: 0,
			scraped: 1,
			is_target: 1,
			source: 'crawled',
			content_type_id: ctHtml!.id,
		},
	]);
	await db('page_meta').insert([{ page_id: 1 }, { page_id: 2 }]);
	await db('anchor_edges').insert({ page_id: 1, href_page_id: 2, count: 2 });
	await db('resource_items').insert({
		id: 10,
		url_id: urlCdn!.id,
		is_external: 1,
		source: 'crawled',
		content_type_id: ctJs!.id,
	});
	await db('resource_ref_edges').insert({ resource_id: 10, page_id: 1, count: 1 });
}

describe('verifyMigration', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('passes on a valid post-6-D archive and returns the row-count summary', async () => {
		await seedValidArchive(db);
		const summary = await verifyMigration(db);
		expect(summary.contentItems).toBe(2);
		expect(summary.pageMeta).toBe(2);
		expect(summary.anchorEdges).toBe(1);
		expect(summary.anchorEdgesSum).toBe(2);
		expect(summary.resourceItems).toBe(1);
	});

	it('wraps non-MigrationVerificationError exceptions with the standard prefix', async () => {
		// Drop a table the checks touch so the first check hits a raw
		// SqliteError. The wrapped error must still carry the
		// "migration verification failed" prefix operators grep for.
		await db.raw('DROP TABLE content_items');
		try {
			await verifyMigration(db);
			expect.unreachable('expected MigrationVerificationError');
		} catch (error) {
			expect(error).toBeInstanceOf(MigrationVerificationError);
			expect((error as Error).message).toContain('migration verification failed');
			expect((error as MigrationVerificationError).details.check).toBe('runtime');
		}
	});

	it('throws MigrationVerificationError from the first check that fails', async () => {
		await seedValidArchive(db);
		// Break invariant #1 by removing one content_items row. Turn FKs off
		// because dropping content_items id=2 would cascade into
		// anchor_edges via the (page_id, href_page_id) FK and defeat the
		// mismatch we want to inspect.
		await db.raw('PRAGMA foreign_keys = OFF');
		await db('content_items').where('id', 2).delete();
		try {
			await verifyMigration(db);
			expect.unreachable('expected MigrationVerificationError');
		} catch (error) {
			expect(error).toBeInstanceOf(MigrationVerificationError);
			expect((error as MigrationVerificationError).details.check).toContain('#1');
		}
	});

	it('reports check #7 when only content-type preservation is broken', async () => {
		await seedValidArchive(db);
		// Break invariant #7 by wiping one content_type_id even though the
		// legacy pages row has a real contentType.
		await db('content_items').where('id', 1).update({ content_type_id: null });
		try {
			await verifyMigration(db);
			expect.unreachable('expected MigrationVerificationError');
		} catch (error) {
			expect(error).toBeInstanceOf(MigrationVerificationError);
			expect((error as MigrationVerificationError).details.check).toContain('#7');
		}
	});

	it('reports check #9 when reader parity fails after every row-count invariant passes', async () => {
		await seedValidArchive(db);
		// Every invariant #1–#8 passes on the seeded archive. Introduce a
		// current-side-only mismatch by silently switching a
		// `content_items.content_type_id` from the html ref to the
		// javascript ref — the row count stays intact (check #7 already
		// runs and passes because the legacy `pages.contentType` and the
		// new `content_type_refs.raw` still both are non-null), but the
		// listPages parity check drops the row on the current side, so
		// #9 trips only after the earlier checks green-light.
		const ctJs = await db('content_type_refs')
			.where('raw', 'application/javascript')
			.first();
		await db('content_items').where('id', 1).update({ content_type_id: ctJs!.id });
		try {
			await verifyMigration(db);
			expect.unreachable('expected MigrationVerificationError');
		} catch (error) {
			expect(error).toBeInstanceOf(MigrationVerificationError);
			expect((error as MigrationVerificationError).details.check).toContain('#9');
		}
	});
});
