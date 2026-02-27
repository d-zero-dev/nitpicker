import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Scope restriction', () => {
	describe('開始URLによるスコープ制限', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl(['http://localhost:8010/scope/blog/']);
		}, 60_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('blog配下のページがクロール対象になる', async () => {
			const internalPages = await result.accessor.getPages('internal-page');
			const urls = internalPages.map((p) => p.url.pathname);
			expect(urls).toContain('/scope/blog/');
			expect(urls).toContain('/scope/blog/post-1');
			expect(urls).toContain('/scope/blog/post-2');
		});

		it('scope外のページはisTarget=falseで記録される', async () => {
			const pages = await result.accessor.getPages('page');
			const docsPage = pages.find((p) => p.url.pathname === '/scope/docs/');
			if (docsPage) {
				expect(docsPage.isTarget).toBe(false);
			}
		});
	});

	describe('scopeオプションで複数パス許可', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl(['http://localhost:8010/scope/blog/'], {
				scope: ['http://localhost:8010/scope/blog/', 'http://localhost:8010/scope/docs/'],
			});
		}, 60_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('scope内の複数パスがクロール対象になる', async () => {
			const internalPages = await result.accessor.getPages('internal-page');
			const urls = internalPages.map((p) => p.url.pathname);
			expect(urls).toContain('/scope/blog/');
			expect(urls).toContain('/scope/blog/post-1');
		});

		it('scopeに含まれないパスはクロール対象外', async () => {
			const internalPages = await result.accessor.getPages('internal-page');
			const urls = internalPages.map((p) => p.url.pathname);
			expect(urls).not.toContain('/scope/admin/');
			expect(urls).not.toContain('/scope/admin/settings');
		});
	});
});
