import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listUnusedResources } from './list-unused-resources.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_unused_resources__');

describe('listUnusedResources', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'unused-resources-test.nitpicker');

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

		// One internal resource that NO page references (the canonical
		// "unused" case).
		await archive.setResources({
			url: parseUrl('https://example.com/orphan.pdf')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/pdf',
			contentLength: 1000,
			compress: false,
			cdn: false,
			headers: {},
		});

		// One referenced resource — must NOT appear in the result.
		await archive.setResources({
			url: parseUrl('https://example.com/used.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 500,
			compress: false,
			cdn: false,
			headers: {},
		});
		// Register a referrer for used.css — needs a page row first.
		await archive.setPage({
			url: parseUrl('https://example.com/page-using-css')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: {
				lang: null,
				title: 'Page with CSS',
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/page-using-css',
			src: 'https://example.com/used.css',
		});

		// One external resource — must NOT appear (inventory targets only
		// in-scope files).
		await archive.setResources({
			url: parseUrl('https://cdn.example.net/external.js')!,
			isExternal: true,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'application/javascript',
			contentLength: 200,
			compress: false,
			cdn: false,
			headers: {},
		});

		// Inventory-seed resource — must appear with the matching source label.
		await archive.setResources(
			{
				url: parseUrl('https://example.com/inventory-seed.pdf')!,
				isExternal: false,
				isError: false,
				status: 200,
				statusText: 'OK',
				contentType: 'application/pdf',
				contentLength: 1500,
				compress: false,
				cdn: false,
				headers: {},
			},
			'inventory-seed',
		);

		// Inventory-discovered resource — same isolation, different label.
		await archive.setResources(
			{
				url: parseUrl('https://example.com/inventory-discovered.png')!,
				isExternal: false,
				isError: false,
				status: 200,
				statusText: 'OK',
				contentType: 'image/png',
				contentLength: 500,
				compress: false,
				cdn: false,
				headers: {},
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

	it('reports only internal resources with no referrers, excluding external resources and referenced ones', async () => {
		const result = await listUnusedResources(archive);

		const urls = result.items.map((row) => row.url);
		// Expected: orphan.pdf + inventory-seed.pdf + inventory-discovered.png.
		// Excluded: used.css (has a referrer), external.js (isExternal=1).
		expect(urls.toSorted()).toEqual([
			'https://example.com/inventory-discovered.png',
			'https://example.com/inventory-seed.pdf',
			'https://example.com/orphan.pdf',
		]);
		expect(urls).not.toContain('https://example.com/used.css');
		expect(urls).not.toContain('https://cdn.example.net/external.js');
	});

	it('returns the source badge from the DB column (crawled / inventory-seed / inventory-discovered)', async () => {
		const result = await listUnusedResources(archive);
		const bySource: Record<string, string | undefined> = {};
		for (const row of result.items) {
			bySource[row.url] = row.source;
		}
		expect(bySource['https://example.com/orphan.pdf']).toBe('crawled');
		expect(bySource['https://example.com/inventory-seed.pdf']).toBe('inventory-seed');
		expect(bySource['https://example.com/inventory-discovered.png']).toBe(
			'inventory-discovered',
		);
	});

	it('respects limit and offset across the full unused set', async () => {
		const first = await listUnusedResources(archive, { limit: 2, offset: 0 });
		expect(first.items).toHaveLength(2);
		const second = await listUnusedResources(archive, { limit: 2, offset: 2 });
		expect(second.items).toHaveLength(1);
		const third = await listUnusedResources(archive, { limit: 2, offset: 3 });
		expect(third.items).toHaveLength(0);
	});
});
