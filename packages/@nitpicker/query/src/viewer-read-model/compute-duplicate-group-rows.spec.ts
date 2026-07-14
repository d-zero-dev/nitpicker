import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeDuplicateGroupRows } from './compute-duplicate-group-rows.js';

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

describe('computeDuplicateGroupRows', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_duplicate_groups__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'compute-duplicate-groups-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		const pages = [
			// Title-duplicate group of 2.
			{ url: 'https://example.com/a', title: 'Dup Title', description: null },
			{ url: 'https://example.com/b', title: 'Dup Title', description: null },
			// Singleton title — must NOT surface as a group.
			{ url: 'https://example.com/c', title: 'Unique Title', description: null },
			// Description-duplicate group of 3.
			{ url: 'https://example.com/x', title: 'X', description: 'Dup Description' },
			{ url: 'https://example.com/y', title: 'Y', description: 'Dup Description' },
			{ url: 'https://example.com/z', title: 'Z', description: 'Dup Description' },
			// Same value shared across BOTH fields, on different pages — must
			// produce two independent groups (one per field), not one shared
			// group id.
			{ url: 'https://example.com/p', title: 'Shared Value', description: null },
			{ url: 'https://example.com/q', title: 'Shared Value', description: null },
			{ url: 'https://example.com/r', title: null, description: 'Shared Value' },
			{ url: 'https://example.com/s', title: null, description: 'Shared Value' },
		];

		for (const p of pages) {
			await archive.setPage({
				url: parseUrl(p.url)!,
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
					title: p.title,
					description: p.description,
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
		}
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('detects title and description duplicate groups, excluding singletons', async () => {
		const { groups } = await archive
			.getKnex()
			.transaction((trx) => computeDuplicateGroupRows(trx));

		const titleGroups = groups.filter((g) => g.field === 'title');
		const descriptionGroups = groups.filter((g) => g.field === 'description');

		expect(titleGroups.map((g) => g.value).toSorted()).toEqual([
			'Dup Title',
			'Shared Value',
		]);
		expect(descriptionGroups.map((g) => g.value).toSorted()).toEqual([
			'Dup Description',
			'Shared Value',
		]);
		expect(groups.some((g) => g.value === 'Unique Title')).toBe(false);
	});

	it('sets count and the negated count_desc_key correctly per group', async () => {
		const { groups } = await archive
			.getKnex()
			.transaction((trx) => computeDuplicateGroupRows(trx));

		const dupTitle = groups.find((g) => g.field === 'title' && g.value === 'Dup Title')!;
		expect(dupTitle.count).toBe(2);
		expect(dupTitle.count_desc_key).toBe(-2);

		const dupDescription = groups.find(
			(g) => g.field === 'description' && g.value === 'Dup Description',
		)!;
		expect(dupDescription.count).toBe(3);
		expect(dupDescription.count_desc_key).toBe(-3);
	});

	it('assigns every group a unique, sequential group_id, distinct across fields even for the same shared value', async () => {
		const { groups, groupIdByValue } = await archive
			.getKnex()
			.transaction((trx) => computeDuplicateGroupRows(trx));

		const groupIds = groups.map((g) => g.group_id);
		expect(new Set(groupIds).size).toBe(groupIds.length);

		const sharedTitleGroupId = groupIdByValue.get('title')!.get('Shared Value');
		const sharedDescriptionGroupId = groupIdByValue
			.get('description')!
			.get('Shared Value');
		expect(sharedTitleGroupId).toBeDefined();
		expect(sharedDescriptionGroupId).toBeDefined();
		expect(sharedTitleGroupId).not.toBe(sharedDescriptionGroupId);
	});

	it('populates groupIdByValue with an entry per group value, matching the groups array 1:1', async () => {
		const { groups, groupIdByValue } = await archive
			.getKnex()
			.transaction((trx) => computeDuplicateGroupRows(trx));

		for (const group of groups) {
			expect(groupIdByValue.get(group.field)!.get(group.value)).toBe(group.group_id);
		}
		expect(groupIdByValue.get('title')!.has('Unique Title')).toBe(false);
	});
});
