import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';
import { TEST_SERVER_PORT } from './test-server-port.js';

describe('Scope restriction', () => {
	describe('開始URLによるスコープ制限', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl([`http://localhost:${TEST_SERVER_PORT}/scope/blog/`]);
		}, 120_000);

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

		it('scope path 外のページは external page として isTarget=false で記録される', async () => {
			// scope=['/scope/blog/'] のとき、同一ホストでも path 外の /scope/docs/ は
			// findScopeEntry が null を返すため external 扱いになり、fetchExternal の
			// デフォルト true で metadata-only スクレイプされる
			const externalPages = await result.accessor.getPages('external-page');
			const docsPage = externalPages.find((p) => p.url.pathname === '/scope/docs/');
			expect(docsPage).toBeDefined();
			expect(docsPage!.isTarget).toBe(false);
		});
	});

	describe('hostname 一致 × scope path 外 + fetchExternal=true', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl([`http://localhost:${TEST_SERVER_PORT}/scope/blog/`], {
				fetchExternal: true,
			});
		}, 120_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('scope path 外のリンクは external page として記録される', async () => {
			const externalPages = await result.accessor.getPages('external-page');
			const externalPaths = externalPages.map((p) => p.url.pathname);
			expect(externalPaths).toContain('/scope/docs/');
		});

		it('scope path 外のリンクは isTarget=false で metadata-only として記録される', async () => {
			const externalPages = await result.accessor.getPages('external-page');
			const docs = externalPages.find((p) => p.url.pathname === '/scope/docs/');
			expect(docs).toBeDefined();
			expect(docs!.isTarget).toBe(false);
		});

		it('scope path 内のページは internal page として記録される', async () => {
			const internalPages = await result.accessor.getPages('internal-page');
			const internalPaths = internalPages.map((p) => p.url.pathname);
			expect(internalPaths).toContain('/scope/blog/');
			expect(internalPaths).toContain('/scope/blog/post-1');
			expect(internalPaths).not.toContain('/scope/docs/');
		});
	});
});
