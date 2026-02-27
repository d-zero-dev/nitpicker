import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Speculative pagination (path-based)', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl(['http://localhost:8010/pagination/'], {
			parallels: 5,
		});
	}, 120_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('page/1〜page/10 が全てDBに保存されている', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const pathnames = pages.map((p) => p.url.pathname).toSorted();
		for (let i = 1; i <= 10; i++) {
			expect(pathnames).toContain(`/pagination/page/${i}`);
		}
	});

	it('page/11 以降（投機的に生成されたが404）はDBに保存されていない', async () => {
		const pages = await result.accessor.getPages('page');
		const pathnames = pages.map((p) => p.url.pathname);
		for (let i = 11; i <= 15; i++) {
			expect(pathnames).not.toContain(`/pagination/page/${i}`);
		}
	});

	it('各ページの status が 200 である', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const paginationPages = pages.filter((p) =>
			p.url.pathname.startsWith('/pagination/page/'),
		);
		for (const page of paginationPages) {
			expect(page.status).toBe(200);
		}
	});
});
