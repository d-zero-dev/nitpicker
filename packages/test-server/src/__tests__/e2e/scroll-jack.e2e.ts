import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Scroll-jack page (viewport-dependent redirect)', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl(['http://localhost:8010/scroll-jack/'], {
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

	it('モバイルビューポートでコンテキスト破壊が起きてもクラッシュしない', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const page = pages.find((p) => p.url.pathname === '/scroll-jack/');
		expect(page).toBeDefined();

		// 画像取得は best-effort。モバイルビューポートで失敗しても
		// クラッシュせずにクロール全体が正常終了することを検証。
		const knex = result.accessor.getKnex();
		const images = await knex('images')
			.join('pages', 'images.pageId', 'pages.id')
			.where('pages.url', page!.url.href)
			.select('images.*');

		// desktop-compact (1280px) は成功するため画像が取得される。
		// mobile-small (320px) はリダイレクトで失敗する可能性があるがクラッシュしない。
		// 少なくともデスクトップ分の画像が存在することを検証。
		expect(images.length).toBeGreaterThanOrEqual(1);

		const desktopImages = images.filter(
			(img: { viewportWidth: number }) => img.viewportWidth === 1280,
		);
		expect(desktopImages.length).toBeGreaterThanOrEqual(1);
	});
});
