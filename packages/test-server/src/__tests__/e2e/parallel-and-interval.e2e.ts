import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Parallel and interval options', () => {
	describe('parallels: 3', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl(['http://localhost:8010/recursive/'], {
				parallels: 3,
			});
		}, 60_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('全ページが正しくクロールされる', async () => {
			const internalPages = await result.accessor.getPages('internal-page');
			const urls = internalPages.map((p) => p.url.pathname).toSorted();
			expect(urls).toContain('/recursive/');
			expect(urls).toContain('/recursive/page-a');
			expect(urls).toContain('/recursive/page-b');
			expect(urls).toContain('/recursive/page-c');
		});

		it('外部リンクも正しく記録される', async () => {
			const externalPages = await result.accessor.getPages('external-page');
			const urls = externalPages.map((p) => p.url.href);
			expect(urls.some((u) => u.includes('127.0.0.1'))).toBe(true);
		});
	});

	describe('interval: 500', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl(['http://localhost:8010/recursive/'], {
				interval: 500,
			});
		}, 60_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('intervalを設定しても正常に完了する', async () => {
			const internalPages = await result.accessor.getPages('internal-page');
			const urls = internalPages.map((p) => p.url.pathname);
			expect(urls).toContain('/recursive/');
			expect(urls.length).toBeGreaterThanOrEqual(4);
		});
	});
});
