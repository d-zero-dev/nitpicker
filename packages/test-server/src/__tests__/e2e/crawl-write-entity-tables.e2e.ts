import type { Knex } from 'knex';

import { buildViewerReadModel } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

/**
 * Legacy flat tables that fresh archives no longer carry — the crawler's
 * write path targets `content_items` / `page_meta` / `anchor_edges` /
 * `resource_items` / `resource_ref_edges` / `image_items` directly and
 * `initSchema` does not declare the legacy DDL at all (the tables only
 * exist inside pre-0.13 archives as the migration script's populate
 * source).
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

	it('legacy テーブル（pages/anchors/images/resources/resources-referrers）は存在しない', async () => {
		const knex = result.accessor.getKnex();
		for (const table of LEGACY_TABLES) {
			const exists = await knex.schema.hasTable(table);
			expect(exists, `expected ${table} to be absent`).toBe(false);
		}
	});

	it('entity/edge テーブル（content_items/page_meta/anchor_edges/resource_items/resource_ref_edges/image_items）に row が作られる', async () => {
		const knex = result.accessor.getKnex();
		for (const table of ENTITY_TABLES) {
			const count = await countRows(knex, table);
			expect(count, `expected ${table} to be non-empty`).toBeGreaterThan(0);
		}
	});

	it('viewer read model が新 writer の書いた entity テーブルから実データを再構成できる', async () => {
		// テーブルの行数チェックだけでは「viewer が中身を読めるか」を
		// 保証できない — read model build を実行し、具体的なページ URL が
		// viewer_pages に現れることまで確認する（crawl → viewer の
		// パイプライン全体が新 writer で成立している証明）。build は
		// 書き込みを伴うため read-only の accessor ではなく writable な
		// archive ハンドルで行う。
		await buildViewerReadModel(result.archive);
		const knex = result.accessor.getKnex();
		const viewerPages = (await knex('viewer_pages').select('url')) as {
			url: string;
		}[];
		expect(viewerPages.length).toBeGreaterThan(0);
		expect(viewerPages.map((p) => p.url)).toContain(
			'http://localhost:8010/resource-reuse/',
		);
	});

	it('image_items の dom_path が実 DOM 由来の値を持つ（unknown/ フォールバックに落ちていない）', async () => {
		// 実クロール中に captureImageDomPaths が puppeteer page から dom_path
		// を採取できていれば、少なくとも 1 行は `unknown/<n>` 合成マーカー
		// ではない実パス（`html/...` 形式）になる。
		const knex = result.accessor.getKnex();
		const rows = (await knex('image_items as ii')
			.join('text_refs as tr', 'ii.dom_path_text_id', 'tr.id')
			.select('tr.text as domPath')) as { domPath: string }[];
		expect(rows.length).toBeGreaterThan(0);
		const realPaths = rows.filter((r) => r.domPath.startsWith('html/'));
		expect(
			realPaths.length,
			`expected at least one real dom path, got: ${rows.map((r) => r.domPath).join(', ')}`,
		).toBeGreaterThan(0);
	});
});
