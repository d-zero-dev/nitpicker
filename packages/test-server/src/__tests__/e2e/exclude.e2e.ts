import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';
import {
	TEST_SERVER_EXTERNAL_ORIGIN,
	TEST_SERVER_ORIGIN,
	TEST_SERVER_PORT,
} from './test-server-port.js';

describe('Exclude patterns', () => {
	describe('パス除外 (excludes)', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl([`${TEST_SERVER_ORIGIN}/exclude/`], {
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

		it('excludes がアーカイブの config に保存される', async () => {
			const config = await result.accessor.getConfig();
			expect(config.excludes).toEqual(['/exclude/secret/*']);
		});
	});

	describe('キーワード除外 (excludeKeywords)', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl([`${TEST_SERVER_ORIGIN}/exclude/`], {
				excludeKeywords: ['FORBIDDEN_KEYWORD'],
			});
		}, 60_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('キーワードマッチしたページがスキップされる', async () => {
			// キーワードマッチしたページはフルスクレイプされず、contentType を持たない
			// スキップ済みスタブとして記録される（→ internal-no-page カテゴリ）。
			const pages = await result.accessor.getPages('internal-no-page');
			const pageB = pages.find((p) => p.url.pathname === '/exclude/page-b');
			expect(pageB).toBeDefined();
			expect(pageB!.isTarget).toBe(false);
			expect(pageB!.isSkipped).toBe(true);
			// スキップ理由にマッチしたキーワードが記録される（他の skip 要因と区別できる）。
			expect(pageB!.skipReason).toContain('FORBIDDEN_KEYWORD');

			// フルスクレイプ済みページ（internal-page）には現れない（negative pin）。
			const fullPages = await result.accessor.getPages('internal-page');
			expect(fullPages.some((p) => p.url.pathname === '/exclude/page-b')).toBe(false);
		});

		it('キーワードマッチしないページは正常にスクレイプされる', async () => {
			const pages = await result.accessor.getPages('internal-page');
			const pageA = pages.find((p) => p.url.pathname === '/exclude/page-a');
			expect(pageA).toBeDefined();
			expect(pageA!.isTarget).toBe(true);
		});

		it('excludeKeywords がアーカイブの config に保存される', async () => {
			const config = await result.accessor.getConfig();
			expect(config.excludeKeywords).toEqual(['FORBIDDEN_KEYWORD']);
		});
	});

	describe('URL プレフィックス除外 (excludeUrls)', () => {
		let result: CrawlResult;

		beforeAll(async () => {
			result = await crawl([`${TEST_SERVER_ORIGIN}/exclude/`], {
				excludeUrls: [`${TEST_SERVER_EXTERNAL_ORIGIN}/exclude/external-a`],
			});
		}, 60_000);

		afterAll(async () => {
			await cleanup(result);
		});

		it('excludeUrls にマッチする外部 URL がスキップされる', async () => {
			const pages = await result.accessor.getPages('external-page');
			const urls = pages.map((p) => p.url.href);
			const hasExternalA = urls.some((u) =>
				u.includes(`127.0.0.1:${TEST_SERVER_PORT}/exclude/external-a`),
			);
			expect(hasExternalA).toBe(false);
		});

		it('excludeUrls にマッチしない外部 URL は取得される', async () => {
			const pages = await result.accessor.getPages('external-page');
			const urls = pages.map((p) => p.url.href);
			const hasExternalB = urls.some((u) =>
				u.includes(`127.0.0.1:${TEST_SERVER_PORT}/exclude/external-b`),
			);
			expect(hasExternalB).toBe(true);
		});

		it('excludeUrls がアーカイブの config に保存される', async () => {
			const config = await result.accessor.getConfig();
			expect(config.excludeUrls).toContain(
				`${TEST_SERVER_EXTERNAL_ORIGIN}/exclude/external-a`,
			);
		});
	});
});
