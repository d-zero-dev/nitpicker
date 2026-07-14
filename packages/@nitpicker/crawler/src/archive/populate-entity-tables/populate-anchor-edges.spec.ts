import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populateRefTables } from '../populate-ref-tables/populate-refs.js';

import { populateAnchorEdges } from './populate-anchor-edges.js';
import { populateContentItems } from './populate-content-items.js';
import { countRows } from './test-utils/count-rows.js';
import { setupMigrationDb } from './test-utils/setup-entities-db.js';

/**
 * Inserts N pages so `anchor_edges` FKs resolve. `populateRefTables`
 * is intentionally NOT called here — the caller inserts anchors first
 * and then runs the phase-ref populate, matching the real migration
 * ordering where anchor textContent has already been ingested into
 * `text_refs` by the time `populateAnchorEdges` runs.
 * @param db - Test DB instance.
 * @param count - Number of pages to insert (id 1..count).
 */
async function seedPages(db: ReturnType<typeof knex>, count: number): Promise<void> {
	const rows = Array.from({ length: count }, (_, index) => ({
		id: index + 1,
		url: `https://example.com/${index + 1}`,
		scraped: 1,
		isTarget: 1,
	}));
	await db('pages').insert(rows);
}

/**
 * Runs 0.13 populate + 0.13 content_items so anchor_edges'
 * `text_refs` lookup and `content_items(id)` FKs both succeed at
 * insert time. Called after every test's anchor seed data so the
 * required refs land in text_refs.
 * @param db - Test DB instance.
 */
async function completeMigrationPrerequisites(
	db: ReturnType<typeof knex>,
): Promise<void> {
	await populateRefTables(db);
	await populateContentItems(db);
}

describe('populateAnchorEdges (anchor-edge-normalization)', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('collapses duplicate anchors sharing (pageId, hrefId) with first-wins semantics', async () => {
		await seedPages(db, 3);
		await db('anchors').insert([
			{ pageId: 1, hrefId: 2, hash: 'a1', textContent: 'first anchor text' },
			{ pageId: 1, hrefId: 2, hash: 'a2', textContent: 'second anchor text' },
			{ pageId: 1, hrefId: 2, hash: 'a3', textContent: 'third anchor text' },
			{ pageId: 1, hrefId: 3, hash: 'b1', textContent: 'other target' },
		]);
		await completeMigrationPrerequisites(db);
		await populateAnchorEdges(db);
		const edges = await db('anchor_edges').select().orderBy(['page_id', 'href_page_id']);
		expect(edges).toHaveLength(2);
		expect(edges[0]!.page_id).toBe(1);
		expect(edges[0]!.href_page_id).toBe(2);
		expect(edges[0]!.count).toBe(3);
		expect(edges[0]!.first_hash).toBe('a1');
		expect(edges[0]!.first_text_id).not.toBeNull();
		expect(edges[1]!.href_page_id).toBe(3);
		expect(edges[1]!.count).toBe(1);
	});

	it('acceptance: SUM(anchor_edges.count) equals count(anchors)', async () => {
		await seedPages(db, 4);
		await db('anchors').insert([
			{ pageId: 1, hrefId: 2, hash: 'a', textContent: 'x' },
			{ pageId: 1, hrefId: 2, hash: 'b', textContent: 'y' },
			{ pageId: 1, hrefId: 3, hash: 'c', textContent: 'z' },
			{ pageId: 2, hrefId: 4, hash: 'd', textContent: 'q' },
			{ pageId: 2, hrefId: 4, hash: 'e', textContent: 'r' },
			{ pageId: 3, hrefId: 4, hash: 'f', textContent: 's' },
		]);
		await completeMigrationPrerequisites(db);
		await populateAnchorEdges(db);
		const anchorsCount = await countRows(db, 'anchors');
		const edgesSumRows = await db('anchor_edges').sum<{ n: number | null }[]>({
			n: 'count',
		});
		const edgesSum = Number(edgesSumRows[0]!.n ?? 0);
		expect(edgesSum).toBe(anchorsCount);
	});

	it('handles null hash / textContent on the first instance', async () => {
		await seedPages(db, 2);
		await db('anchors').insert([
			{ pageId: 1, hrefId: 2, hash: null, textContent: null },
			{ pageId: 1, hrefId: 2, hash: 'later', textContent: 'later text' },
		]);
		await completeMigrationPrerequisites(db);
		await populateAnchorEdges(db);
		const edge = await db('anchor_edges').where('page_id', 1).first();
		expect(edge.first_hash).toBeNull();
		expect(edge.first_text_id).toBeNull();
		expect(edge.count).toBe(2);
	});

	it('collapses correctly when a (pageId, hrefId) pair straddles two READ_CHUNK_SIZE boundaries', async () => {
		// Regression guard for the internal `carryOver` state — this is
		// the ONLY streaming state that spans chunk boundaries.
		// READ_CHUNK_SIZE is 5000, so 5001 anchors on the same
		// (pageId=1, hrefId=2) pair force the collapse across the
		// boundary. The final edge must have `count = 5001` and
		// `first_hash = 'first'`.
		await seedPages(db, 2);
		const bulk = Array.from({ length: 5001 }, (_, index) => ({
			pageId: 1,
			hrefId: 2,
			hash: index === 0 ? 'first' : `later-${index}`,
			textContent: index === 0 ? 'first anchor' : `anchor-${index}`,
		}));
		// Batch-insert in small chunks — knex serialises `INSERT ...
		// VALUES` for libsql as a big `SELECT ... UNION ALL` and the
		// generated SQL text hits the SQL length ceiling well before the
		// variable-count ceiling. 200 rows keeps each statement under
		// the ceiling.
		for (let index = 0; index < bulk.length; index += 200) {
			await db('anchors').insert(bulk.slice(index, index + 200));
		}
		await completeMigrationPrerequisites(db);
		await populateAnchorEdges(db);
		const edges = await db('anchor_edges').select();
		expect(edges).toHaveLength(1);
		expect(edges[0]!.count).toBe(5001);
		expect(edges[0]!.first_hash).toBe('first');
	}, 30_000);

	it('is idempotent (upsert on unique(page_id, href_page_id))', async () => {
		await seedPages(db, 2);
		await db('anchors').insert([{ pageId: 1, hrefId: 2, hash: 'x', textContent: 'x' }]);
		await completeMigrationPrerequisites(db);
		await populateAnchorEdges(db);
		await populateAnchorEdges(db);
		expect(await countRows(db, 'anchor_edges')).toBe(1);
	});
});
