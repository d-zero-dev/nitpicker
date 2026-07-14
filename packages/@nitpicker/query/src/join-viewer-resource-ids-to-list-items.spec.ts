import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { populateMigrationTables } from './__test-utils__/populate-migration-tables.js';
import { joinViewerResourceIdsToListItems } from './join-viewer-resource-ids-to-list-items.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

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

describe('joinViewerResourceIdsToListItems', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_join_viewer_resource_ids_to_list_items__',
	);
	const archiveFilePath = path.resolve(workingDir, 'join-resources-test.nitpicker');
	let archive: InstanceType<typeof Archive>;
	let idA: number;
	let idB: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setResources({
			url: parseUrl('https://example.com/a.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 100,
			compress: 'gzip',
			cdn: 'cloudflare',
			headers: {},
		});
		await archive.setResources({
			url: parseUrl('https://example.com/b.js')!,
			isExternal: false,
			isError: false,
			status: 404,
			statusText: 'Not Found',
			contentType: 'application/javascript',
			contentLength: 200,
			compress: false,
			cdn: false,
			headers: {},
		});

		await archive.setPage({
			url: parseUrl('https://example.com/page-a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: {
				lang: null,
				title: 'Page A',
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
		// a.css has one referrer (referrerCount: 1); b.js has none, exercising
		// the LEFT JOIN's coalesce-to-0 default.
		await archive.setResourcesReferrers({
			url: 'https://example.com/page-a',
			src: 'https://example.com/a.css',
		});

		const knex = archive.getKnex();
		const rows: { id: number; url: string }[] = await knex('resources').select(
			'id',
			'url',
		);
		idA = rows.find((r) => r.url === 'https://example.com/a.css')!.id;
		idB = rows.find((r) => r.url === 'https://example.com/b.js')!.id;

		await buildViewerReadModel(archive);
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty array for an empty id list without querying', async () => {
		const knex = archive.getKnex();
		expect(await joinViewerResourceIdsToListItems(knex, [])).toEqual([]);
	});

	it('joins ids back to full ResourceEntry rows, preserving the requested id order (not DB order)', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerResourceIdsToListItems(knex, [idB, idA]);
		expect(items.map((i) => i.url)).toEqual([
			'https://example.com/b.js',
			'https://example.com/a.css',
		]);
	});

	it('joins referrerCount from viewer_resource_stats', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerResourceIdsToListItems(knex, [idA, idB]);
		expect(items[0]).toMatchObject({ referrerCount: 1 });
	});

	it('defaults referrerCount to 0 for a resource with no referrers', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerResourceIdsToListItems(knex, [idB]);
		expect(items[0]).toMatchObject({ referrerCount: 0 });
	});

	it('normalises the falsy-0 compress/cdn sentinels to null', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerResourceIdsToListItems(knex, [idA, idB]);
		expect(items[0]).toMatchObject({ compress: 'gzip', cdn: 'cloudflare' });
		expect(items[1]).toMatchObject({ compress: null, cdn: null });
	});
});
