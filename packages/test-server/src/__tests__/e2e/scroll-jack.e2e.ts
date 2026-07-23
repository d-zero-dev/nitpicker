import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';
import { TEST_SERVER_PORT } from './test-server-port.js';

describe('Scroll-jack page (viewport-dependent redirect)', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl([`http://localhost:${TEST_SERVER_PORT}/scroll-jack/`], {
			recursive: false,
			image: true,
		});
	}, 120_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('ページデータが正常に取得される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const page = pages.find((p) => p.url.pathname === '/scroll-jack/');
		expect(page).toBeDefined();
		expect(page!.status).toBe(200);
		expect(page!.title).toBe('Scroll Jack Page');
	});

	it('ビューポート依存リダイレクトのあるページで画像が取得される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const page = pages.find((p) => p.url.pathname === '/scroll-jack/');
		expect(page).toBeDefined();

		const knex = result.accessor.getKnex();
		const images = await knex('image_items')
			.join('content_items', 'image_items.page_id', 'content_items.id')
			.join('url_refs', 'content_items.url_id', 'url_refs.id')
			.where('url_refs.url', page!.url.href)
			.select('image_items.*');

		// クロールが正常完了し、少なくともデスクトップ分の画像が取得される。
		expect(images.length).toBeGreaterThanOrEqual(1);

		const desktopImages = images.filter(
			(img: { viewport_width: number }) => img.viewport_width === 1280,
		);
		expect(desktopImages.length).toBeGreaterThanOrEqual(1);
	});
});
