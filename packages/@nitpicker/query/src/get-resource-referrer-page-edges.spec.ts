import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import Archive from '@nitpicker/archive/archive';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getResourceReferrerEdges } from './get-resource-referrer-edges.js';
import { getResourceReferrerPageEdges } from './get-resource-referrer-page-edges.js';
import { resolvePageUrls } from './html-snapshot-scan/resolve-page-urls.js';

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

/**
 * @param url - The page URL.
 * @returns The `setPage` argument for a plain crawled HTML page.
 */
function page(url: string) {
	return {
		url: parseUrl(url)!,
		redirectPaths: [],
		isExternal: false,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 100,
		responseHeaders: {},
		html: '',
		meta: { ...META, title: url },
		anchorList: [],
		imageList: [],
		isSkipped: false,
	};
}

/**
 * @param url - The resource URL.
 * @returns The `setResources` argument for a plain stylesheet.
 */
function resource(url: string) {
	return {
		url: parseUrl(url)!,
		isExternal: false,
		isError: false,
		status: 200,
		statusText: 'OK',
		contentType: 'text/css',
		contentLength: 1000,
		compress: false,
		cdn: false,
		headers: null,
	};
}

describe('getResourceReferrerPageEdges', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_get_resource_referrer_page_edges__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'get-resource-referrer-page-edges-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;
	let styleId: number;
	let unusedId: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);
		await archive.setPage(page('https://example.com/'));
		await archive.setPage(page('https://example.com/about'));
		await archive.setResources(resource('https://example.com/style.css'));
		await archive.setResources(resource('https://example.com/unused.css'));
		await archive.setResourcesReferrers({
			url: 'https://example.com',
			src: 'https://example.com/style.css',
		});
		await archive.setResourcesReferrers({
			url: 'https://example.com/about',
			src: 'https://example.com/style.css',
		});

		const knex = archive.getKnex();
		const resourceId = async (url: string): Promise<number> => {
			const row = await knex('resource_items as ri')
				.join('url_refs as ur', 'ur.id', 'ri.url_id')
				.select('ri.id as id')
				.where('ur.url', url)
				.first();
			return row.id;
		};
		styleId = await resourceId('https://example.com/style.css');
		unusedId = await resourceId('https://example.com/unused.css');
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty array for an empty resource id list', async () => {
		expect(await getResourceReferrerPageEdges(archive.getKnex(), [])).toEqual([]);
	});

	it('returns the same (resource, page) pairs as getResourceReferrerEdges, without the URL', async () => {
		const knex = archive.getKnex();
		const withUrls = await getResourceReferrerEdges(knex, [styleId]);
		const pageEdges = await getResourceReferrerPageEdges(knex, [styleId]);
		expect(pageEdges).toHaveLength(2);
		expect(pageEdges.map((edge) => ({ ...edge }))).toEqual(
			withUrls.map(({ resourceId, pageId }) => ({ resourceId, pageId })),
		);
		for (const edge of pageEdges) {
			expect(Object.keys(edge).toSorted()).toEqual(['pageId', 'resourceId']);
		}
	});

	it('returns no rows for a resource with no referrers', async () => {
		expect(await getResourceReferrerPageEdges(archive.getKnex(), [unusedId])).toEqual([]);
	});

	it('drops an edge whose page has no content_items row, exactly as getResourceReferrerEdges does', async () => {
		const knex = archive.getKnex();
		// The foreign key forbids such an edge, so switch it off for the insert.
		await knex.raw('PRAGMA foreign_keys = OFF');
		await knex('resource_ref_edges').insert({
			resource_id: styleId,
			page_id: 987_654,
			count: 1,
		});
		await knex.raw('PRAGMA foreign_keys = ON');
		try {
			const pageEdges = await getResourceReferrerPageEdges(knex, [styleId]);
			const withUrls = await getResourceReferrerEdges(knex, [styleId]);
			expect(pageEdges).toHaveLength(2);
			expect(withUrls).toHaveLength(2);
			expect(pageEdges.map((edge) => edge.pageId).toSorted()).toEqual(
				withUrls.map((edge) => edge.pageId).toSorted(),
			);
			expect(pageEdges.some((edge) => edge.pageId === 987_654)).toBe(false);
		} finally {
			await knex('resource_ref_edges').where({ page_id: 987_654 }).delete();
		}
	});

	it('returns only pages that resolvePageUrls can give a URL for, since resource groups look the sampled URLs up with it afterwards', async () => {
		const knex = archive.getKnex();
		const pageEdges = await getResourceReferrerPageEdges(knex, [styleId]);
		const pageIds = pageEdges.map((edge) => edge.pageId);
		const urlByPageId = await resolvePageUrls(knex, pageIds);
		expect(pageIds).toHaveLength(2);
		expect(pageIds.map((pageId) => urlByPageId.get(pageId)).toSorted()).toEqual([
			'https://example.com',
			'https://example.com/about',
		]);
	});

	it('handles more resource ids than one IN chunk holds', async () => {
		const ids = Array.from(
			{ length: 1200 },
			(_, index) => styleId + (index + 1) * 1_000_000,
		);
		ids[700] = styleId;
		const pageEdges = await getResourceReferrerPageEdges(archive.getKnex(), ids);
		expect(pageEdges.filter((edge) => edge.resourceId === styleId)).toHaveLength(2);
	});
});
