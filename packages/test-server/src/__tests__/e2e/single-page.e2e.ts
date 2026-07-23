import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';
import { TEST_SERVER_PORT } from './test-server-port.js';

describe('Single page scraping', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl([`http://localhost:${TEST_SERVER_PORT}/`], { recursive: false });
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
		// 子ページは title-only モードで text/html ページとして記録されるが isTarget=false。
		// 'page' フィルタは isTarget=1 のみを返すため internal-page で引く。
		const pages = await result.accessor.getPages('internal-page');
		const aboutPages = pages.filter((p) => p.url.pathname === '/about');
		expect(aboutPages.length).toBeGreaterThan(0);
		// titleOnlyモードでスクレイプされた場合、isTarget=falseであること
		expect(aboutPages[0]!.isTarget).toBe(false);
	});
});
