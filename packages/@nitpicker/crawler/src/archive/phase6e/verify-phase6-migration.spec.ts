import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populatePhase6BRefs } from '../phase6b/populate-phase6b-refs.js';
import { setupPhase6DDb } from '../phase6d/test-utils/setup-phase6d-db.js';

import { Phase6VerificationError } from './types.js';
import { verifyPhase6Migration } from './verify-phase6-migration.js';

/**
 * Builds a small end-to-end fixture that exercises every populate path
 * (content_items, page_meta, anchor_edges, image_items, resource_items,
 * resource_ref_edges) enough to make the orchestrator's happy-path
 * assertion meaningful. Ref tables are populated via the real Phase 6-B
 * populator so `url_refs.url` matches `pages.url` verbatim (required by
 * check #8's round-trip).
 * @param db - Knex handle from {@link setupPhase6DDb}.
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
	await populatePhase6BRefs(db);
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

describe('verifyPhase6Migration', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupPhase6DDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('passes on a valid post-6-D archive and returns the row-count summary', async () => {
		await seedValidArchive(db);
		const summary = await verifyPhase6Migration(db);
		expect(summary.contentItems).toBe(2);
		expect(summary.pageMeta).toBe(2);
		expect(summary.anchorEdges).toBe(1);
		expect(summary.anchorEdgesSum).toBe(2);
		expect(summary.resourceItems).toBe(1);
	});

	it('wraps non-Phase6VerificationError exceptions with the standard prefix', async () => {
		// Drop a table the checks touch so the first check hits a raw
		// SqliteError. The wrapped error must still carry the
		// "Phase 6 verification failed" prefix operators grep for.
		await db.raw('DROP TABLE content_items');
		try {
			await verifyPhase6Migration(db);
			expect.unreachable('expected Phase6VerificationError');
		} catch (error) {
			expect(error).toBeInstanceOf(Phase6VerificationError);
			expect((error as Error).message).toContain('Phase 6 verification failed');
			expect((error as Phase6VerificationError).details.check).toBe('runtime');
		}
	});

	it('throws Phase6VerificationError from the first check that fails', async () => {
		await seedValidArchive(db);
		// Break invariant #1 by removing one content_items row. Turn FKs off
		// because dropping content_items id=2 would cascade into
		// anchor_edges via the (page_id, href_page_id) FK and defeat the
		// mismatch we want to inspect.
		await db.raw('PRAGMA foreign_keys = OFF');
		await db('content_items').where('id', 2).delete();
		try {
			await verifyPhase6Migration(db);
			expect.unreachable('expected Phase6VerificationError');
		} catch (error) {
			expect(error).toBeInstanceOf(Phase6VerificationError);
			expect((error as Phase6VerificationError).details.check).toContain('#1');
		}
	});

	it('reports check #7 when only content-type preservation is broken', async () => {
		await seedValidArchive(db);
		// Break invariant #7 by wiping one content_type_id even though the
		// legacy pages row has a real contentType.
		await db('content_items').where('id', 1).update({ content_type_id: null });
		try {
			await verifyPhase6Migration(db);
			expect.unreachable('expected Phase6VerificationError');
		} catch (error) {
			expect(error).toBeInstanceOf(Phase6VerificationError);
			expect((error as Phase6VerificationError).details.check).toContain('#7');
		}
	});
});
