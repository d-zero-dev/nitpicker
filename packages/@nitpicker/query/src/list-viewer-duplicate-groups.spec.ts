import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listViewerDuplicateGroups } from './list-viewer-duplicate-groups.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_list_viewer_duplicate_groups__',
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

describe('listViewerDuplicateGroups', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'list-viewer-duplicate-groups-test.nitpicker',
	);

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

		const pages: { pathname: string; title: string; description: string | null }[] = [
			// Title group "Group A" — 5 members, used to verify pagesLimit capping.
			{ pathname: '/a1', title: 'Group A', description: null },
			{ pathname: '/a2', title: 'Group A', description: null },
			{ pathname: '/a3', title: 'Group A', description: null },
			{ pathname: '/a4', title: 'Group A', description: null },
			{ pathname: '/a5', title: 'Group A', description: null },
			// Title group "Group B" — 2 members, fewer than "Group A".
			{ pathname: '/b1', title: 'Group B', description: null },
			{ pathname: '/b2', title: 'Group B', description: null },
			// Description group — independent of the title groups above.
			{ pathname: '/d1', title: 'Unique D1', description: 'Shared Description' },
			{ pathname: '/d2', title: 'Unique D2', description: 'Shared Description' },
			// Singleton — must not appear in either field's groups.
			{ pathname: '/u1', title: 'Unique Title', description: 'Unique Description' },
		];

		for (const p of pages) {
			await archive.setPage({
				url: parseUrl(`https://example.com${p.pathname}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '',
				meta: { ...META, title: p.title, description: p.description },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		await populateMigrationTables(archive);
		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('lists title duplicate groups ordered by count descending', async () => {
		const result = await listViewerDuplicateGroups(archive, { field: 'title' });
		expect(result.items.map((item) => item.value)).toEqual(['Group A', 'Group B']);
		expect(result.items.map((item) => item.count)).toEqual([5, 2]);
		expect(result.total).toBe(2);
	});

	it('lists description duplicate groups independently of title groups', async () => {
		const result = await listViewerDuplicateGroups(archive, { field: 'description' });
		expect(result.items).toHaveLength(1);
		expect(result.items[0]!.value).toBe('Shared Description');
		expect(result.items[0]!.count).toBe(2);
		expect(result.items[0]!.pages.toSorted()).toEqual([
			'https://example.com/d1',
			'https://example.com/d2',
		]);
	});

	it('caps the inline pages sample at pagesLimit, leaving count as the true total', async () => {
		const result = await listViewerDuplicateGroups(archive, {
			field: 'title',
			pagesLimit: 2,
		});
		const groupA = result.items.find((item) => item.value === 'Group A')!;
		expect(groupA.count).toBe(5);
		expect(groupA.pages).toHaveLength(2);
		expect(groupA.count).toBeGreaterThan(groupA.pages.length);
	});

	it('does not cap the inline pages sample when the group is smaller than pagesLimit', async () => {
		const result = await listViewerDuplicateGroups(archive, { field: 'title' });
		const groupB = result.items.find((item) => item.value === 'Group B')!;
		expect(groupB.pages).toHaveLength(2);
		expect(groupB.count).toBe(groupB.pages.length);
	});

	it('paginates forward via nextCursor and matches an equivalent offset read', async () => {
		const page1 = await listViewerDuplicateGroups(archive, { field: 'title', limit: 1 });
		expect(page1.items.map((item) => item.value)).toEqual(['Group A']);
		expect(page1.nextCursor).not.toBeNull();

		const page2 = await listViewerDuplicateGroups(archive, {
			field: 'title',
			limit: 1,
			cursor: page1.nextCursor!,
		});
		expect(page2.items.map((item) => item.value)).toEqual(['Group B']);
		expect(page2.nextCursor).toBeNull();

		const offsetPage2 = await listViewerDuplicateGroups(archive, {
			field: 'title',
			limit: 1,
			offset: 1,
		});
		expect(offsetPage2.items.map((item) => item.value)).toEqual(
			page2.items.map((item) => item.value),
		);
	});

	it('paginates backward via prevCursor', async () => {
		const page2 = await listViewerDuplicateGroups(archive, {
			field: 'title',
			limit: 1,
			offset: 1,
		});
		expect(page2.prevCursor).not.toBeNull();

		const page1 = await listViewerDuplicateGroups(archive, {
			field: 'title',
			limit: 1,
			cursor: page2.prevCursor!,
			direction: 'prev',
		});
		expect(page1.items.map((item) => item.value)).toEqual(['Group A']);
	});

	it('rejects a cursor minted under a different field', async () => {
		const page1 = await listViewerDuplicateGroups(archive, { field: 'title', limit: 1 });
		await expect(
			listViewerDuplicateGroups(archive, {
				field: 'description',
				limit: 1,
				cursor: page1.nextCursor!,
			}),
		).rejects.toThrow(/does not match/);
	});
});
