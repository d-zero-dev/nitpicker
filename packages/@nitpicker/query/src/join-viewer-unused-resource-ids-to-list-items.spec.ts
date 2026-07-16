import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { joinViewerUnusedResourceIdsToListItems } from './join-viewer-unused-resource-ids-to-list-items.js';

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

describe('joinViewerUnusedResourceIdsToListItems', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_join_viewer_unused_resource_ids_to_list_items__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'join-unused-resources-test.nitpicker',
	);
	let archive: InstanceType<typeof Archive>;
	let idA: number;
	let idB: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setResources({
			url: parseUrl('https://example.com/orphan-a.pdf')!,
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
		await archive.setResources(
			{
				url: parseUrl('https://example.com/orphan-b.png')!,
				isExternal: false,
				isError: false,
				status: 404,
				statusText: 'Not Found',
				contentType: 'image/png',
				contentLength: 500,
				compress: false,
				cdn: false,
				headers: {},
			},
			'inventory-discovered',
		);

		const knex = archive.getKnex();
		const rows: { id: number; url: string }[] = await knex('resources').select(
			'id',
			'url',
		);
		idA = rows.find((r) => r.url === 'https://example.com/orphan-a.pdf')!.id;
		idB = rows.find((r) => r.url === 'https://example.com/orphan-b.png')!.id;
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
		expect(await joinViewerUnusedResourceIdsToListItems(knex, [])).toEqual([]);
	});

	it('joins ids back to full UnusedResourceEntry rows, preserving the requested id order (not DB order)', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerUnusedResourceIdsToListItems(knex, [idB, idA]);
		expect(items.map((i) => i.url)).toEqual([
			'https://example.com/orphan-b.png',
			'https://example.com/orphan-a.pdf',
		]);
	});

	it('returns the source badge from the DB column', async () => {
		const knex = archive.getKnex();
		const items = await joinViewerUnusedResourceIdsToListItems(knex, [idA, idB]);
		expect(items[0]).toMatchObject({ source: 'crawled' });
		expect(items[1]).toMatchObject({ source: 'inventory-discovered' });
	});
});
