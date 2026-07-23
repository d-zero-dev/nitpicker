import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';
import { TEST_SERVER_ORIGIN } from './test-server-port.js';

describe('Multi-root crawl', () => {
	describe('同一ホスト × 複数サブパス起点', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl([
				`${TEST_SERVER_ORIGIN}/scope/blog/`,
				`${TEST_SERVER_ORIGIN}/scope/docs/`,
			]);
		}, 120_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('両方の起点下のページが internal として記録される', async () => {
			const internalPages = await result.accessor.getPages('internal-page');
			const paths = internalPages.map((p) => p.url.pathname);
			expect(paths).toContain('/scope/blog/');
			expect(paths).toContain('/scope/blog/post-1');
			expect(paths).toContain('/scope/docs/');
			expect(paths).toContain('/scope/docs/api');
		});

		it('どちらの scope path 下にも無い同一ホストの URL は internal にならない', async () => {
			const internalPages = await result.accessor.getPages('internal-page');
			const paths = internalPages.map((p) => p.url.pathname);
			expect(paths).not.toContain('/scope/admin/');
		});

		it('info.roots に両方の起点 URL が記録される', async () => {
			const config = await result.accessor.getConfig();
			expect(config.roots).toEqual([
				`${TEST_SERVER_ORIGIN}/scope/blog/`,
				`${TEST_SERVER_ORIGIN}/scope/docs/`,
			]);
		});
	});
});
