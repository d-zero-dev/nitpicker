import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Single page scraping', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl(['http://localhost:8010/'], { recursive: false });
	});

	afterAll(async () => {
		await cleanup(result);
	});

	it('基本ページのスクレイプ', async () => {
		const pages = await result.accessor.getPages('page');
		const targetPages = pages.filter((p) => p.isTarget);
		expect(targetPages.length).toBe(1);

		const page = targetPages[0]!;
		expect(page.title).toBe('Test Top');
		expect(page.status).toBe(200);
		expect(page.contentType).toContain('text/html');
		expect(page.isTarget).toBe(true);
		expect(page.isExternal).toBe(false);
	});

	it('非再帰モードで子ページはisTarget=falseで記録される', async () => {
		const pages = await result.accessor.getPages('page');
		const aboutPages = pages.filter((p) => p.url.pathname === '/about');
		if (aboutPages.length > 0) {
			// titleOnlyモードでスクレイプされた場合、isTarget=falseであること
			expect(aboutPages[0]!.isTarget).toBe(false);
		}
	});
});
