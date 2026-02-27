import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Recursive crawling', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl(['http://localhost:8010/recursive/']);
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('内部リンクを再帰的にクロールする', async () => {
		const internalPages = await result.accessor.getPages('internal-page');
		const urls = internalPages.map((p) => p.url.pathname).toSorted();
		expect(urls).toContain('/recursive/');
		expect(urls).toContain('/recursive/page-a');
		expect(urls).toContain('/recursive/page-b');
		expect(urls).toContain('/recursive/page-c');
	});

	it('アンカー関係がDBに記録される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const topPage = pages.find((p) => p.url.pathname === '/recursive/');
		expect(topPage).toBeDefined();

		const anchors = await topPage!.getAnchors();
		const anchorUrls = anchors.map((a) => a.url);
		expect(anchorUrls.some((u) => u.includes('/recursive/page-a'))).toBe(true);
		expect(anchorUrls.some((u) => u.includes('/recursive/page-b'))).toBe(true);
		expect(anchorUrls.some((u) => u.includes('/recursive/page-c'))).toBe(true);
	});

	it('外部リンク(127.0.0.1)がisExternal=trueで記録される', async () => {
		const externalPages = await result.accessor.getPages('external-page');
		const urls = externalPages.map((p) => p.url.href);
		expect(urls.some((u) => u.includes('127.0.0.1'))).toBe(true);
	});

	it('recursive: false で再帰しない', async () => {
		const nonRecursiveResult = await crawl(['http://localhost:8010/recursive/'], {
			recursive: false,
		});

		try {
			const pages = await nonRecursiveResult.accessor.getPages('page');
			const targetPages = pages.filter((p) => p.isTarget);
			expect(targetPages.length).toBe(1);
		} finally {
			await cleanup(nonRecursiveResult);
		}
	}, 60_000);
});
