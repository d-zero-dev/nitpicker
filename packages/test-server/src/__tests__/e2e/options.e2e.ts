import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Crawler options', () => {
	describe('fetchExternal: false', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl(['http://localhost:8010/options/'], {
				fetchExternal: false,
			});
		}, 60_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('外部リンクがフェッチされずにDBに記録される', async () => {
			const pages = await result.accessor.getPages('external-page');
			const externalPage = pages.find((p) => p.url.hostname === '127.0.0.1');
			if (externalPage) {
				// fetchExternal: false の場合、外部ページはフルスクレイプされない
				expect(
					externalPage.status === null ||
						externalPage.status === 0 ||
						externalPage.title === '',
				).toBe(true);
			}
		});

		it('内部ページは通常通りスクレイプされる', async () => {
			const pages = await result.accessor.getPages('internal-page');
			const pageA = pages.find((p) => p.url.pathname === '/options/page-a');
			expect(pageA).toBeDefined();
			expect(pageA!.isTarget).toBe(true);
		});
	});

	describe('fetchExternal: true (no-page filters)', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl(['http://localhost:8010/options/'], {
				fetchExternal: true,
			});
		}, 60_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('internal-no-page で内部の非HTMLリソースが取得できる', async () => {
			const pages = await result.accessor.getPages('internal-no-page');
			const internalJson = pages.find((p) => p.url.pathname === '/options/data.json');
			expect(internalJson).toBeDefined();
			expect(internalJson!.url.hostname).toBe('localhost');
		});

		it('external-no-page で外部の非HTMLリソースが取得できる', async () => {
			const pages = await result.accessor.getPages('external-no-page');
			const externalJson = pages.find((p) => p.url.pathname === '/options/data.json');
			expect(externalJson).toBeDefined();
			expect(externalJson!.url.hostname).toBe('127.0.0.1');
		});
	});

	describe('disableQueries: true', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl(['http://localhost:8010/options/'], {
				disableQueries: true,
			});
		}, 60_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('クエリパラメータが除去されてURLが正規化される', async () => {
			const pages = await result.accessor.getPages('internal-page');
			const pageA = pages.find((p) => p.url.pathname === '/options/page-a');
			expect(pageA).toBeDefined();
			// disableQueries: true なので、URLにクエリパラメータが含まれないこと
			expect(pageA!.url.query).toBeNull();
		});
	});
});
