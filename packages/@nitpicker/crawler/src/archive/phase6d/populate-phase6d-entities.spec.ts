import type { DomPathResult } from './types.js';
import type knex from 'knex';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { populatePhase6BRefs } from '../phase6b/populate-phase6b-refs.js';

import { populatePhase6DEntities } from './populate-phase6d-entities.js';
import { countRows } from './test-utils/count-rows.js';
import { setupPhase6DDb } from './test-utils/setup-phase6d-db.js';

describe('populatePhase6DEntities (orchestrator)', () => {
	let db: ReturnType<typeof knex>;

	beforeEach(async () => {
		db = await setupPhase6DDb();
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
		await populatePhase6BRefs(db);

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
			await populatePhase6DEntities(trx, resolver, () => Promise.resolve(null));
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
});
