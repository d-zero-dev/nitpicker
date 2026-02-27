import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Redirect handling', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl(['http://localhost:8010/redirect/']);
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('リダイレクトチェーンを辿って最終ページをスクレイプする', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const dest = pages.find((p) => p.url.pathname === '/redirect/dest');
		expect(dest).toBeDefined();
		expect(dest!.title).toBe('Redirect Destination');
		expect(dest!.status).toBe(200);
	});

	it('リダイレクト元ページもDBに記録される', async () => {
		// getPages() (フィルタなし) で全ページを取得し、リダイレクト元の存在を確認
		const allPages = await result.accessor.getPages();
		const startPage = allPages.find((p) => p.url.href.includes('/redirect/start'));
		expect(startPage).toBeDefined();
		// リダイレクト元はスクレイプ対象ではない（リダイレクトされるため）
		expect(startPage!.isTarget).toBe(false);
	});

	it('redirectFrom でリダイレクト元URLが取得できる', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const dest = pages.find((p) => p.url.pathname === '/redirect/dest');
		expect(dest).toBeDefined();

		expect(dest!.redirectFrom.length).toBeGreaterThan(0);
		expect(dest!.redirectFrom.some((r) => r.url.includes('/redirect/start'))).toBe(true);
	});

	it('最終ページからのリンクも収集される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const dest = pages.find((p) => p.url.pathname === '/redirect/dest');
		expect(dest).toBeDefined();

		const anchors = await dest!.getAnchors();
		const anchorUrls = anchors.map((a) => a.url);
		expect(anchorUrls.some((u) => u.includes('/redirect/start'))).toBe(true);
	});
});
