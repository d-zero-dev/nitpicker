import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Error status codes', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl(['http://localhost:8010/error-status/']);
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('404ステータスがDBに記録される', async () => {
		const pages = await result.accessor.getPages('page');
		const notFound = pages.find((p) => p.url.pathname === '/error-status/not-found');
		expect(notFound).toBeDefined();
		expect(notFound!.status).toBe(404);
	});

	it('500ステータスがDBに記録される', async () => {
		const pages = await result.accessor.getPages('page');
		const serverError = pages.find(
			(p) => p.url.pathname === '/error-status/server-error',
		);
		expect(serverError).toBeDefined();
		expect(serverError!.status).toBe(500);
	});

	it('403ステータスがDBに記録される', async () => {
		const pages = await result.accessor.getPages('page');
		const forbidden = pages.find((p) => p.url.pathname === '/error-status/forbidden');
		expect(forbidden).toBeDefined();
		expect(forbidden!.status).toBe(403);
	});

	it('正常ページはisTarget=trueで記録される', async () => {
		const pages = await result.accessor.getPages('page');
		const normal = pages.find((p) => p.url.pathname === '/error-status/normal');
		expect(normal).toBeDefined();
		expect(normal!.status).toBe(200);
		expect(normal!.isTarget).toBe(true);
	});
});
