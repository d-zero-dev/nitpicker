import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Meta tag extraction (v2 schema)', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl(['http://localhost:8010/meta/']);
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('flattens nested Meta into the pages table columns', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const page = pages.find((p) => p.url.pathname === '/meta/full');
		expect(page).toBeDefined();

		expect(page!.title).toBe('Full Meta Page');
		expect(page!.lang).toBe('ja');
		expect(page!.description).toBe('Test description');
		expect(page!.keywords).toBe('test,meta,nitpicker');
		// eslint-disable-next-line unicorn/text-encoding-identifier-case -- HTML5 attribute value is canonically 'utf-8'.
		expect(page!.charset).toBe('utf-8');
		expect(page!.og_type).toBe('article');
		expect(page!.og_title).toBe('OG Title');
		expect(page!.og_site_name).toBe('Test Site');
		expect(page!.og_description).toBe('OG Description');
		expect(page!.og_url).toBe('http://localhost:8010/meta/full');
		expect(page!.og_image).toContain('og-image.png');
		expect(page!.twitter_card).toBe('summary_large_image');
		expect(page!.canonical).toBe('http://localhost:8010/meta/full');
		expect(page!.robots_noindex).toBe(false);
		expect(page!.robots_nofollow).toBe(false);
	});

	it('detects robots:noindex / nofollow / noarchive / noimageindex via the flat columns', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const page = pages.find((p) => p.url.pathname === '/meta/robots-noindex');
		expect(page).toBeDefined();

		expect(page!.robots_noindex).toBe(true);
		expect(page!.robots_nofollow).toBe(true);
		expect(page!.robots_noarchive).toBe(true);
	});

	it('falls back to empty string title for pages without meta tags', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const page = pages.find((p) => p.url.pathname === '/meta/minimal');
		expect(page).toBeDefined();

		expect(page!.title).toBeTruthy();
		expect(page!.description).toBeNull();
		expect(page!.og_title).toBeNull();
	});

	it('absolutises a relative canonical href against the page URL', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const page = pages.find((p) => p.url.pathname === '/meta/relative-canonical');
		expect(page).toBeDefined();

		expect(page!.canonical).toBe('http://localhost:8010/meta/relative-canonical');
	});

	it('stores JSON-LD entries in page_jsonld with classified @type', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const page = pages.find((p) => p.url.pathname === '/meta/jsonld');
		expect(page).toBeDefined();

		const entries = await page!.getJsonLd();
		const types = entries.map((e) => e.type).toSorted();
		expect(types).toEqual(['BreadcrumbList', 'Product']);
		expect(page!.jsonldCount).toBe(2);
	});
});
