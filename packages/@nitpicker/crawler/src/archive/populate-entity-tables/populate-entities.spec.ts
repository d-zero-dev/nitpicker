import type { DomPathResult } from './types.js';
import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populateRefTables } from '../populate-ref-tables/populate-refs.js';

import { populateEntityTables } from './populate-entities.js';
import { countRows } from './test-utils/count-rows.js';
import { setupMigrationDb } from './test-utils/setup-entities-db.js';

describe('populateEntityTables (orchestrator)', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupMigrationDb();
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('runs every sub-step and satisfies all four acceptance count invariants', async () => {
		await db('pages').insert([
			{ id: 1, url: 'https://example.com/a', scraped: 1, isTarget: 1 },
			{ id: 2, url: 'https://example.com/b', scraped: 1, isTarget: 1 },
			{ id: 3, url: 'https://example.com/c', scraped: 0, isTarget: 0 },
		]);
		await db('resources').insert([{ id: 10, url: 'https://cdn.example.com/x.js' }]);
		await db('resources-referrers').insert([{ resourceId: 10, pageId: 1 }]);
		await db('anchors').insert([
			{ pageId: 1, hrefId: 2, hash: 'a', textContent: 'link' },
			{ pageId: 1, hrefId: 2, hash: 'b', textContent: 'link' },
		]);
		await db('images').insert([
			{
				id: 5,
				pageId: 1,
				src: 'https://example.com/img.png',
				alt: null,
				width: 1,
				height: 1,
				naturalWidth: 1,
				naturalHeight: 1,
				isLazy: 0,
				viewportWidth: 1,
				sourceCode: '<img src="https://example.com/img.png">',
			},
		]);
		await populateRefTables(db);

		const resolver = (
			_pageId: number,
			_html: string | null,
			images: readonly { id: number }[],
		): Promise<ReadonlyMap<number, DomPathResult>> => {
			const map = new Map<number, DomPathResult>();
			for (const image of images) {
				map.set(image.id, { path: `unknown/${image.id}`, case: 'unknown' });
			}
			return Promise.resolve(map);
		};
		await db.transaction(async (trx) => {
			await populateEntityTables(trx, resolver);
		});

		const contentItemsCount = await countRows(db, 'content_items');
		const pagesCount = await countRows(db, 'pages');
		expect(contentItemsCount).toBe(pagesCount);
		const pageMetaCount = await countRows(db, 'page_meta', 'page_id');
		const scrapedRows = await db('pages')
			.where('scraped', true)
			.count<{ n: number }[]>({ n: 'id' });
		const scrapedCount = Number(scrapedRows[0]!.n);
		expect(pageMetaCount).toBe(scrapedCount);
		const anchorSumRows = await db('anchor_edges').sum<{ n: number | null }[]>({
			n: 'count',
		});
		const anchorSum = Number(anchorSumRows[0]!.n ?? 0);
		expect(anchorSum).toBe(await countRows(db, 'anchors'));
		expect(await countRows(db, 'image_items')).toBe(await countRows(db, 'images'));
	});

	it('a re-populate after mutating pages/resources/anchors/images reflects the new state (no stale first-populate rows)', async () => {
		// First-crawl-like state.
		await db('pages').insert([
			{
				id: 1,
				url: 'https://example.com/a',
				scraped: 1,
				isTarget: 1,
				source: 'inventory-seed',
				status: 500,
			},
			{
				id: 2,
				url: 'https://example.com/b',
				scraped: 1,
				isTarget: 1,
				source: 'crawled',
				status: 200,
			},
		]);
		await db('resources').insert([
			{ id: 10, url: 'https://cdn.example.com/x.js', status: 500 },
		]);
		await db('anchors').insert([
			{ pageId: 1, hrefId: 2, hash: 'x1', textContent: 'link (old)' },
		]);
		await db('images').insert([
			{
				id: 100,
				pageId: 1,
				src: 'https://example.com/old.png',
				alt: null,
				width: 1,
				height: 1,
				naturalWidth: 1,
				naturalHeight: 1,
				isLazy: 0,
				viewportWidth: 1,
				sourceCode: '<img src="https://example.com/old.png">',
			},
		]);
		await populateRefTables(db);

		const resolver = (
			_pageId: number,
			_html: string | null,
			images: readonly { id: number }[],
		): Promise<ReadonlyMap<number, DomPathResult>> => {
			const map = new Map<number, DomPathResult>();
			for (const image of images) {
				map.set(image.id, { path: `unknown/${image.id}`, case: 'unknown' });
			}
			return Promise.resolve(map);
		};
		await db.transaction(async (trx) => {
			await populateEntityTables(trx, resolver);
		});

		// Sanity: first-populate visible.
		const initialCi = await db('content_items').where('id', 1).first();
		expect(initialCi.source).toBe('inventory-seed');
		expect(initialCi.status).toBe(500);
		const initialImg = await db('image_items').where('id', 100).first();
		expect(initialImg).toBeDefined();

		// Simulate what `crawl --append` does: source-priority upgrades
		// the row, status is refreshed, anchors + images are deleted
		// then re-inserted with brand-new ids.
		await db('pages').where('id', 1).update({ source: 'crawled', status: 200 });
		await db('resources').where('id', 10).update({ status: 200 });
		await db('anchors').where('pageId', 1).delete();
		await db('anchors').insert([
			{ pageId: 1, hrefId: 2, hash: 'x2', textContent: 'link (new)' },
			{ pageId: 1, hrefId: 2, hash: 'x3', textContent: 'link (also new)' },
		]);
		await db('images').where('pageId', 1).delete();
		await db('images').insert([
			{
				id: 200,
				pageId: 1,
				src: 'https://example.com/new.png',
				alt: null,
				width: 1,
				height: 1,
				naturalWidth: 1,
				naturalHeight: 1,
				isLazy: 0,
				viewportWidth: 1,
				sourceCode: '<img src="https://example.com/new.png">',
			},
		]);
		await populateRefTables(db);

		await db.transaction(async (trx) => {
			await populateEntityTables(trx, resolver);
		});

		// content_items reflects the source-priority upgrade + refreshed status.
		const refreshedCi = await db('content_items').where('id', 1).first();
		expect(refreshedCi.source).toBe('crawled');
		expect(refreshedCi.status).toBe(200);
		// resource_items reflects the refreshed status.
		const refreshedRi = await db('resource_items').where('id', 10).first();
		expect(refreshedRi.status).toBe(200);
		// The stale image_items row (id=100) is gone; only the new id=200 remains.
		const staleImg = await db('image_items').where('id', 100).first();
		expect(staleImg).toBeUndefined();
		const freshImg = await db('image_items').where('id', 200).first();
		expect(freshImg).toBeDefined();
		// The anchor_edge count reflects the two new anchors, not the one old anchor.
		const anchorEdge = await db('anchor_edges')
			.where({ page_id: 1, href_page_id: 2 })
			.first();
		expect(anchorEdge.count).toBe(2);
	});
});
