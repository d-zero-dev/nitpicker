import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { populateMigrationTables } from './__test-utils__/populate-migration-tables.js';
import { joinViewerPageIdsToListItems } from './join-viewer-page-ids-to-list-items.js';

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

describe('joinViewerPageIdsToListItems', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_join_viewer_page_ids_to_list_items__',
	);
	const archiveFilePath = path.resolve(workingDir, 'join-test.nitpicker');
	let archive: InstanceType<typeof Archive>;
	let idA: number;
	let idB: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: { 'content-security-policy': "default-src 'self'" },
			html: '<html></html>',
			meta: { ...META, title: 'A', og: { title: 'OG A' } },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/b')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'B' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		const knex = archive.getKnex();
		const rows: { id: number; url: string }[] = await knex('pages').select('id', 'url');
		idA = rows.find((r) => r.url === 'https://example.com/a')!.id;
		idB = rows.find((r) => r.url === 'https://example.com/b')!.id;
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
		expect(await joinViewerPageIdsToListItems(knex, [])).toEqual([]);
	});

	it('joins ids back to full PageListItem rows, preserving the requested id order (not DB order)', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerPageIdsToListItems(knex, [idB, idA]);
		expect(items.map((i) => i.url)).toEqual([
			'https://example.com/b',
			'https://example.com/a',
		]);
		expect(items[1]).toMatchObject({ title: 'A', ogTitle: 'OG A' });
	});

	it('computes header-presence flags on the joined row, not just the write-model columns', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerPageIdsToListItems(knex, [idA, idB]);
		expect(items[0]).toMatchObject({
			hasCSP: true,
			hasXFrameOptions: false,
			hasXContentTypeOptions: false,
			hasHSTS: false,
		});
		expect(items[1]).toMatchObject({ hasCSP: false });
	});
});
