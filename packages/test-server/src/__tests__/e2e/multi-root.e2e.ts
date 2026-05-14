import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Multi-root crawl', () => {
	describe('同一ホスト × 複数サブパス起点', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl([
				'http://localhost:8010/scope/blog/',
				'http://localhost:8010/scope/docs/',
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
				'http://localhost:8010/scope/blog/',
				'http://localhost:8010/scope/docs/',
			]);
		});

		it('info.scope は roots と --scope の union として記録される', async () => {
			const config = await result.accessor.getConfig();
			expect(config.scope).toEqual(
				expect.arrayContaining([
					'http://localhost:8010/scope/blog/',
					'http://localhost:8010/scope/docs/',
				]),
			);
		});
	});

	describe('位置引数 + --scope の union', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl(['http://localhost:8010/scope/blog/'], {
				scope: ['http://localhost:8010/scope/docs/'],
			});
		}, 120_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('--scope で追加された path も internal 扱いになる', async () => {
			const internalPages = await result.accessor.getPages('internal-page');
			const paths = internalPages.map((p) => p.url.pathname);
			expect(paths).toContain('/scope/blog/');
			expect(paths).toContain('/scope/docs/');
		});

		it('info.scope に位置引数 URL と --scope 値が union される', async () => {
			const config = await result.accessor.getConfig();
			expect(config.scope).toEqual(
				expect.arrayContaining([
					'http://localhost:8010/scope/blog/',
					'http://localhost:8010/scope/docs/',
				]),
			);
		});

		it('info.roots は位置引数のみ', async () => {
			const config = await result.accessor.getConfig();
			expect(config.roots).toEqual(['http://localhost:8010/scope/blog/']);
		});
	});
});
