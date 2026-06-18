import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listIsolatedPages } from './list-isolated-pages.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_isolated_pages__');

/**
 * Minimal Meta object for `setPage`, mirroring what beholder produces for
 * pages with no `<meta>` tags. Spelled out here so each test reads as
 * "isolation depends on link graph, not metadata".
 */
const EMPTY_META = {
	lang: null,
	title: null,
	description: null,
	keywords: null,
	noindex: false,
	nofollow: false,
	noarchive: false,
	canonical: null,
	alternate: null,
	'og:type': null,
	'og:title': null,
	'og:site_name': null,
	'og:description': null,
	'og:url': null,
	'og:image': null,
	'twitter:card': null,
};

describe('listIsolatedPages', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'isolated-pages-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
			version: '0.10.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			roots: ['https://example.com'],
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'test',
			ignoreRobots: false,
		});

		// Root page — linked from nothing, BUT is an archived root, so it must
		// NOT be reported as isolated (roots are seeds by definition).
		await archive.setPage({
			url: parseUrl('https://example.com')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...EMPTY_META, title: 'Home' },
			anchorList: [
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: 'About',
					hash: null,
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// About — linked from Home, so NOT isolated.
		await archive.setPage({
			url: parseUrl('https://example.com/about')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...EMPTY_META, title: 'About' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Hidden — no inbound anchors, not a root. EXPECTED isolated row.
		await archive.setPage({
			url: parseUrl('https://example.com/hidden')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...EMPTY_META, title: 'Hidden LP' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// External page — no inbound anchors, not a root, but isExternal=1.
		// MUST be filtered out (inventory targets in-scope pages only).
		await archive.setExternalPage({
			url: parseUrl('https://external.example.net/page')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...EMPTY_META, title: 'External Page' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Inventory-seed page — no inbound anchors, not a root. MUST appear
		// with source='inventory-seed' on the row.
		await archive.setPage(
			{
				url: parseUrl('https://example.com/inventory-seed-page')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Inventory Seed Page' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);

		// Inventory-discovered page — same isolation status, but `source` label
		// must come through differently.
		await archive.setPage(
			{
				url: parseUrl('https://example.com/inventory-discovered-page')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Inventory Discovered Page' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			'inventory-discovered',
		);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('reports internal HTML pages with no inbound anchors, excluding archived roots and external pages', async () => {
		const result = await listIsolatedPages(archive);

		// Expected: /hidden + /inventory-seed-page + /inventory-discovered-page
		// (3 internal, no-inbound, non-root pages).
		// Excluded: /  (root), /about (linked), external page.
		const urls = result.items.map((row) => row.url);
		expect(urls.toSorted()).toEqual([
			'https://example.com/hidden',
			'https://example.com/inventory-discovered-page',
			'https://example.com/inventory-seed-page',
		]);
		expect(urls).not.toContain('https://example.com');
		expect(urls).not.toContain('https://example.com/about');
		expect(urls).not.toContain('https://external.example.net/page');
	});

	it('returns the source badge from the DB column (crawled / inventory-seed / inventory-discovered)', async () => {
		const result = await listIsolatedPages(archive);
		const bySource: Record<string, string | undefined> = {};
		for (const row of result.items) {
			bySource[row.url] = row.source;
		}
		expect(bySource['https://example.com/hidden']).toBe('crawled');
		expect(bySource['https://example.com/inventory-seed-page']).toBe('inventory-seed');
		expect(bySource['https://example.com/inventory-discovered-page']).toBe(
			'inventory-discovered',
		);
	});

	it('respects limit and offset across the full isolated set', async () => {
		// 3 isolated rows total. Walk the pagination manually.
		const first = await listIsolatedPages(archive, { limit: 2, offset: 0 });
		expect(first.items).toHaveLength(2);
		const second = await listIsolatedPages(archive, { limit: 2, offset: 2 });
		expect(second.items).toHaveLength(1);
		const third = await listIsolatedPages(archive, { limit: 2, offset: 3 });
		expect(third.items).toHaveLength(0);
	});
});
