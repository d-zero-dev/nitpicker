import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('HTML snapshot and metadata', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl(['http://localhost:8010/meta/']);
	}, 60_000);

	afterAll(async () => {
		if (result) {
			await cleanup(result);
		}
	});

	it('各ページのtitleがDBに記録される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const fullPage = pages.find((p) => p.url.pathname === '/meta/full');
		expect(fullPage).toBeDefined();
		expect(fullPage!.title).toBe('Full Meta Page');
	});

	it('複数ページのメタデータが正しく記録される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const pagesWithTitle = pages.filter((p) => p.title);
		expect(pagesWithTitle.length).toBeGreaterThanOrEqual(2);
	});

	it('contentTypeがtext/htmlとして記録される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		for (const page of pages) {
			expect(page.contentType).toContain('text/html');
		}
	});
});
