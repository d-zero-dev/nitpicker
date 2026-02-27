import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Exclude patterns', () => {
	describe('パス除外 (excludes)', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl(['http://localhost:8010/exclude/'], {
				excludes: ['/exclude/secret/*'],
			});
		}, 60_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('除外パターンにマッチするURLがスキップされる', async () => {
			const pages = await result.accessor.getPages('page');
			const urls = pages.map((p) => p.url.pathname);
			expect(urls).not.toContain('/exclude/secret/hidden');
			expect(urls).toContain('/exclude/page-a');
			expect(urls).toContain('/exclude/page-b');
		});
	});

	describe('キーワード除外 (excludeKeywords)', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl(['http://localhost:8010/exclude/'], {
				excludeKeywords: ['FORBIDDEN_KEYWORD'],
			});
		}, 60_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('キーワードマッチしたページがスキップされる', async () => {
			const pages = await result.accessor.getPages('internal-page');
			const pageBUrls = pages.filter((p) => p.url.pathname === '/exclude/page-b');
			// page-b should either not be present or be marked as not a target
			if (pageBUrls.length > 0) {
				expect(pageBUrls[0]!.isTarget).toBe(false);
			}
		});

		it('キーワードマッチしないページは正常にスクレイプされる', async () => {
			const pages = await result.accessor.getPages('internal-page');
			const pageA = pages.find((p) => p.url.pathname === '/exclude/page-a');
			expect(pageA).toBeDefined();
			expect(pageA!.isTarget).toBe(true);
		});
	});
});
