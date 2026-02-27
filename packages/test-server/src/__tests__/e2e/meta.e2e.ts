import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Meta tag extraction', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl(['http://localhost:8010/meta/']);
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('全メタフィールドが抽出される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const page = pages.find((p) => p.url.pathname === '/meta/full');
		expect(page).toBeDefined();

		expect(page!.title).toBe('Full Meta Page');
		expect(page!.lang).toBe('ja');
		expect(page!.description).toBe('Test description');
		expect(page!.keywords).toBe('test,meta,nitpicker');
		expect(page!.og_type).toBe('website');
		expect(page!.og_title).toBe('OG Title');
		expect(page!.og_site_name).toBe('Test Site');
		expect(page!.og_description).toBe('OG Description');
		expect(page!.og_url).toBe('http://localhost:8010/meta/full');
		expect(page!.og_image).toContain('og-image.png');
		expect(page!.twitter_card).toBe('summary_large_image');
		expect(page!.canonical).toBe('http://localhost:8010/meta/full');
		expect(page!.alternate).toBe('http://localhost:8010/meta/full-en');
		expect(page!.noindex).toBe(false);
		expect(page!.nofollow).toBe(false);
	});

	it('robots noindex/nofollow/noarchive が検出される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const page = pages.find((p) => p.url.pathname === '/meta/robots-noindex');
		expect(page).toBeDefined();

		expect(page!.noindex).toBe(true);
		expect(page!.nofollow).toBe(true);
		expect(page!.noarchive).toBe(true);
	});

	it('メタタグなしページでもデフォルト値で記録される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const page = pages.find((p) => p.url.pathname === '/meta/minimal');
		expect(page).toBeDefined();

		expect(page!.title).toBeTruthy();
		expect(page!.description).toBe('');
		expect(page!.og_title).toBe('');
	});
});
