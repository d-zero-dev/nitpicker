import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { populateMigrationTables } from './__test-utils__/populate-migration-tables.js';
import { listViewerDuplicateGroupPages } from './list-viewer-duplicate-group-pages.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_list_viewer_duplicate_group_pages__',
);

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

describe('listViewerDuplicateGroupPages', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'list-viewer-duplicate-group-pages-test.nitpicker',
	);
	let groupId: number;
	let otherGroupId: number;

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig({
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
		});

		// Group with 5 members — enough to exercise cursor pagination with a
		// small limit.
		for (const pathname of ['/a1', '/a2', '/a3', '/a4', '/a5']) {
			await archive.setPage({
				url: parseUrl(`https://example.com${pathname}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '',
				meta: { ...META, title: 'Group A' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		// A second, independent group — used to confirm groupId filtering.
		for (const pathname of ['/b1', '/b2']) {
			await archive.setPage({
				url: parseUrl(`https://example.com${pathname}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '',
				meta: { ...META, title: 'Group B' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		await buildViewerReadModel(archive);

		const knex = archive.getKnex();
		const groupARow = await knex('viewer_duplicate_groups')
			.where({ field: 'title', value: 'Group A' })
			.first();
		const groupBRow = await knex('viewer_duplicate_groups')
			.where({ field: 'title', value: 'Group B' })
			.first();
		groupId = groupARow.group_id;
		otherGroupId = groupBRow.group_id;
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('lists every member page of one group ordered by url ascending', async () => {
		const result = await listViewerDuplicateGroupPages(archive, { groupId });
		expect(result.items).toEqual([
			'https://example.com/a1',
			'https://example.com/a2',
			'https://example.com/a3',
			'https://example.com/a4',
			'https://example.com/a5',
		]);
		expect(result.total).toBe(5);
	});

	it('does not leak member pages from a different group', async () => {
		const result = await listViewerDuplicateGroupPages(archive, {
			groupId: otherGroupId,
		});
		expect(result.items).toEqual(['https://example.com/b1', 'https://example.com/b2']);
		expect(result.total).toBe(2);
	});

	it('paginates forward via nextCursor and matches an equivalent offset read', async () => {
		const page1 = await listViewerDuplicateGroupPages(archive, { groupId, limit: 2 });
		expect(page1.items).toEqual(['https://example.com/a1', 'https://example.com/a2']);
		expect(page1.nextCursor).not.toBeNull();

		const page2 = await listViewerDuplicateGroupPages(archive, {
			groupId,
			limit: 2,
			cursor: page1.nextCursor!,
		});
		expect(page2.items).toEqual(['https://example.com/a3', 'https://example.com/a4']);
		expect(page2.nextCursor).not.toBeNull();

		const page3 = await listViewerDuplicateGroupPages(archive, {
			groupId,
			limit: 2,
			cursor: page2.nextCursor!,
		});
		expect(page3.items).toEqual(['https://example.com/a5']);
		expect(page3.nextCursor).toBeNull();

		const offsetPage2 = await listViewerDuplicateGroupPages(archive, {
			groupId,
			limit: 2,
			offset: 2,
		});
		expect(offsetPage2.items).toEqual(page2.items);
	});

	it('paginates backward via prevCursor', async () => {
		const page2 = await listViewerDuplicateGroupPages(archive, {
			groupId,
			limit: 2,
			offset: 2,
		});
		expect(page2.prevCursor).not.toBeNull();

		const page1 = await listViewerDuplicateGroupPages(archive, {
			groupId,
			limit: 2,
			cursor: page2.prevCursor!,
			direction: 'prev',
		});
		expect(page1.items).toEqual(['https://example.com/a1', 'https://example.com/a2']);
	});

	it('rejects a cursor minted under a different groupId', async () => {
		const page1 = await listViewerDuplicateGroupPages(archive, { groupId, limit: 2 });
		await expect(
			listViewerDuplicateGroupPages(archive, {
				groupId: otherGroupId,
				limit: 2,
				cursor: page1.nextCursor!,
			}),
		).rejects.toThrow(/does not match/);
	});
});
