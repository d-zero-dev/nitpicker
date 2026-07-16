import type { Knex } from 'knex';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

/**
 * Legacy flat tables the crawler's write path stops writing to once it
 * targets `content_items` / `page_meta` / `anchor_edges` / `resource_items`
 * / `resource_ref_edges` / `image_items` directly.
 */
const LEGACY_TABLES = ['pages', 'anchors', 'images', 'resources', 'resources-referrers'];

/**
 * Entity/edge tables the crawler's write path targets directly during a
 * crawl (not a crawl-end derived layer).
 */
const ENTITY_TABLES = [
	'content_items',
	'page_meta',
	'anchor_edges',
	'resource_items',
	'resource_ref_edges',
	'image_items',
];

/**
 * Counts the rows in the given table via a raw `count(*)`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param table - The table name to count.
 * @returns The row count.
 */
async function countRows(knex: Knex, table: string): Promise<number> {
	const row = await knex(table).count<{ c: number }>({ c: '*' }).first();
	return Number(row?.c ?? 0);
}

describe('crawler write path targets entity tables directly (issue #196)', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		// `/resource-reuse/` exercises pages, anchors, images (as both inline
		// sub-resources and direct anchors), sub-resources, a redirect chain,
		// and an external host in a single crawl — every entity table this
		// suite asserts on gets at least one row from one crawl. `image: true`
		// overrides the helper's default (`false`) so `<img>` elements are
		// extracted into `images` / `image_items`.
		result = await crawl(['http://localhost:8010/resource-reuse/'], { image: true });
	}, 120_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('legacy テーブル（pages/anchors/images/resources/resources-referrers）には書かれない', async () => {
		const knex = result.accessor.getKnex();
		for (const table of LEGACY_TABLES) {
			const count = await countRows(knex, table);
			expect(count, `expected ${table} to be empty`).toBe(0);
		}
	});

	it('entity/edge テーブル（content_items/page_meta/anchor_edges/resource_items/resource_ref_edges/image_items）に row が作られる', async () => {
		const knex = result.accessor.getKnex();
		for (const table of ENTITY_TABLES) {
			const count = await countRows(knex, table);
			expect(count, `expected ${table} to be non-empty`).toBeGreaterThan(0);
		}
	});
});
