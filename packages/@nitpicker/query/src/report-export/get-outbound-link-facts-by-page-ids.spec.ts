import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildViewerReadModel } from '../viewer-read-model/build-viewer-read-model.js';

import { getOutboundLinkFactsByPageIds } from './get-outbound-link-facts-by-page-ids.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.13.0',
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
};

const META = {
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

describe('getOutboundLinkFactsByPageIds', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_get_outbound_link_facts_by_page_ids__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'get-outbound-link-facts-by-page-ids-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;
	let sourcePageId: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/source')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: 'Source' },
			anchorList: [
				{
					href: parseUrl('https://example.com/broken')!,
					isExternal: false,
					title: null,
					textContent: 'Broken 1',
				},
				{
					href: parseUrl('https://example.com/broken')!,
					isExternal: false,
					title: null,
					textContent: 'Broken 2',
				},
				{
					href: parseUrl('https://example.com/ok')!,
					isExternal: false,
					title: null,
					textContent: 'OK link',
				},
				{
					href: parseUrl('https://external.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'External link',
				},
			],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/broken')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/ok')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://external.example.com/')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		const knex = archive.getKnex();
		const row = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/source')
			.first();
		sourcePageId = row.id;

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty map for an empty page id list without querying', async () => {
		const result = await getOutboundLinkFactsByPageIds(archive, []);
		expect(result.size).toBe(0);
	});

	it('sums occurrence counts for internal and external links separately', async () => {
		const result = await getOutboundLinkFactsByPageIds(archive, [sourcePageId]);
		const facts = result.get(sourcePageId)!;
		// 2 duplicate anchors to /broken + 1 to /ok = 3 internal occurrences.
		expect(facts.internalLinks).toBe(3);
		expect(facts.externalLinks).toBe(1);
	});

	it('counts a status >= 400 (excluding 401) as bad, at occurrence granularity', async () => {
		const result = await getOutboundLinkFactsByPageIds(archive, [sourcePageId]);
		const facts = result.get(sourcePageId)!;
		expect(facts.internalBadLinks).toBe(2);
		expect(facts.externalBadLinks).toBe(0);
	});

	it('includes the destination URL and anchor text in the bad-link note', async () => {
		const result = await getOutboundLinkFactsByPageIds(archive, [sourcePageId]);
		const facts = result.get(sourcePageId)!;
		expect(facts.internalBadLinkNote).toContain('https://example.com/broken');
		expect(facts.internalBadLinkNote).toContain('404');
	});

	it('returns no entry for a page with no outbound links', async () => {
		const knex = archive.getKnex();
		const okRow = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/ok')
			.first();
		const result = await getOutboundLinkFactsByPageIds(archive, [okRow.id]);
		expect(result.has(okRow.id)).toBe(false);
	});
});
