import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { joinViewerImageIdsToListItems } from './join-viewer-image-ids-to-list-items.js';
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

const NOOP_META = {
	lang: null,
	title: 'Page',
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

describe('joinViewerImageIdsToListItems', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_join_viewer_image_ids_to_list_items__',
	);
	const archiveFilePath = path.resolve(workingDir, 'join-images-test.nitpicker');
	let archive: InstanceType<typeof Archive>;
	let idA: number;
	let idB: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/page')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: NOOP_META,
			anchorList: [],
			imageList: [
				{
					src: 'https://example.com/a.png',
					currentSrc: 'https://example.com/a-current.png',
					alt: 'A',
					width: 100,
					height: 50,
					naturalWidth: 200,
					naturalHeight: 100,
					isLazy: true,
					viewportWidth: 1200,
					sourceCode: '<img src="a.png" alt="A">',
				},
				{
					src: 'https://example.com/b.png',
					currentSrc: 'https://example.com/b.png',
					alt: null as unknown as string,
					width: 10,
					height: 10,
					naturalWidth: 10,
					naturalHeight: 10,
					isLazy: false,
					viewportWidth: 1200,
					sourceCode: '<img src="b.png">',
				},
			],
			isSkipped: false,
		});

		const knex = archive.getKnex();
		const rows: { id: number; src: string }[] = await knex('images').select('id', 'src');
		idA = rows.find((r) => r.src === 'https://example.com/a.png')!.id;
		idB = rows.find((r) => r.src === 'https://example.com/b.png')!.id;

		await buildViewerReadModel(archive);
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
		expect(await joinViewerImageIdsToListItems(knex, [])).toEqual([]);
	});

	it('joins ids back to full ImageEntry rows, preserving the requested id order (not DB order)', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerImageIdsToListItems(knex, [idB, idA]);
		expect(items.map((i) => i.src)).toEqual([
			'https://example.com/b.png',
			'https://example.com/a.png',
		]);
	});

	it('keeps src and currentSrc distinct', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerImageIdsToListItems(knex, [idA]);
		expect(items[0]).toMatchObject({
			src: 'https://example.com/a.png',
			currentSrc: 'https://example.com/a-current.png',
		});
	});

	it('never selects sourceCode', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerImageIdsToListItems(knex, [idA]);
		expect(items[0]).not.toHaveProperty('sourceCode');
	});

	it('coerces isLazy to a boolean', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerImageIdsToListItems(knex, [idA, idB]);
		expect(items[0]).toMatchObject({ isLazy: true });
		expect(items[1]).toMatchObject({ isLazy: false });
	});
});
