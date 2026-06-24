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
 * pages with no `<meta>` tags. Isolation in the new spec is judged
 * purely by `source` label + resolved-anchor connectivity, so this stays
 * stripped to keep each test focused on the predicate under inspection.
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

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
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

		// Crawled root — must NOT appear (source = 'crawled' is not isolated by definition).
		await archive.setPage({
			url: parseUrl('https://example.com/')!,
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
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Crawled page with no anchor inbound — must NOT appear (the
		// source-based filter explicitly rejects 'crawled' rows; this row
		// would have surfaced as an orphan under the old link-graph rule).
		await archive.setPage({
			url: parseUrl('https://example.com/crawled-orphan')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...EMPTY_META, title: 'Crawled Orphan' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Singleton inventory-seed — no anchors in or out. MUST appear.
		await archive.setPage(
			{
				url: parseUrl('https://example.com/lonely-seed')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Lonely Seed' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);

		// Cluster member inventory-seed (A) — anchors to B. MUST NOT appear
		// because B (another inventory-* node) joins A in a connected
		// component → cluster size 2.
		await archive.setPage(
			{
				url: parseUrl('https://example.com/cluster-a')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Cluster A' },
				anchorList: [
					{
						href: parseUrl('https://example.com/cluster-b')!,
						isExternal: false,
						title: null,
						textContent: 'B',
						hash: null,
					},
				],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);
		await archive.setPage(
			{
				url: parseUrl('https://example.com/cluster-b')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Cluster B' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			'inventory-discovered',
		);

		// Outbound-only inventory-seed — anchors to the crawled root. The
		// edge crosses the inventory→crawled boundary so it doesn't pull
		// this seed into a component with the root. Remains singleton.
		await archive.setPage(
			{
				url: parseUrl('https://example.com/outbound-to-crawled')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Outbound to Crawled' },
				anchorList: [
					{
						href: parseUrl('https://example.com/')!,
						isExternal: false,
						title: null,
						textContent: 'Home',
						hash: null,
					},
				],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns inventory-seed singletons with no inbound resolved-anchor', async () => {
		const result = await listIsolatedPages(archive);
		const urls = result.items.map((row) => row.url);
		// /lonely-seed and /outbound-to-crawled are singletons.
		// /cluster-a and /cluster-b are linked → cluster (not singleton).
		// /crawled-orphan and / (root) are 'crawled' source → never singleton.
		expect(urls.toSorted()).toEqual([
			'https://example.com/lonely-seed',
			'https://example.com/outbound-to-crawled',
		]);
		expect(result.total).toBe(2);
	});

	it('excludes crawled rows even when they have no anchor inbound', async () => {
		const result = await listIsolatedPages(archive);
		const urls = result.items.map((row) => row.url);
		expect(urls).not.toContain('https://example.com/crawled-orphan');
		// WHATWG parseUrl normalises the root URL to include a trailing
		// slash — assert the actual stored form, not the operator-facing
		// short form, so a regression that lets the root leak in would
		// actually be caught.
		expect(urls).not.toContain('https://example.com/');
	});

	it('excludes cluster members (size ≥ 2 components)', async () => {
		const result = await listIsolatedPages(archive);
		const urls = result.items.map((row) => row.url);
		expect(urls).not.toContain('https://example.com/cluster-a');
		expect(urls).not.toContain('https://example.com/cluster-b');
	});

	it('reports an inventory-* source for every returned row', async () => {
		// Typically every singleton is `'inventory-seed'`, but a discovered
		// row whose discoverer was demoted to `'crawled'` would surface as
		// `'inventory-discovered'`. Both labels are valid — the contract
		// is that `'crawled'` never appears.
		const result = await listIsolatedPages(archive);
		for (const row of result.items) {
			expect(['inventory-seed', 'inventory-discovered']).toContain(row.source);
			expect(row.source).not.toBe('crawled');
		}
	});

	it('respects limit and offset, with stable total across pages', async () => {
		const first = await listIsolatedPages(archive, { limit: 1, offset: 0 });
		expect(first.items).toHaveLength(1);
		expect(first.total).toBe(2);
		const second = await listIsolatedPages(archive, { limit: 1, offset: 1 });
		expect(second.items).toHaveLength(1);
		expect(second.total).toBe(2);
		const third = await listIsolatedPages(archive, { limit: 1, offset: 2 });
		expect(third.items).toHaveLength(0);
		expect(third.total).toBe(2);
	});
});
