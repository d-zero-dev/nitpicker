import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { countDuplicateGroups } from './count-duplicate-groups.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_count_duplicate_groups__');

describe('countDuplicateGroups', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'count-dup-test.nitpicker');

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

		const pages = [
			// Three distinct title-duplicate groups, so the total group COUNT
			// (3) differs from any small `limit` a caller might pass to
			// `findDuplicates` — the exact scenario `getDuplicatesFastPath`'s
			// legacy fallback needs an accurate total for.
			{ url: 'https://example.com/a1', title: 'Group A', description: null },
			{ url: 'https://example.com/a2', title: 'Group A', description: null },
			{ url: 'https://example.com/b1', title: 'Group B', description: null },
			{ url: 'https://example.com/b2', title: 'Group B', description: null },
			{ url: 'https://example.com/c1', title: 'Group C', description: null },
			{ url: 'https://example.com/c2', title: 'Group C', description: null },
			// Singleton — must not count as a duplicate group.
			{ url: 'https://example.com/unique', title: 'Unique Title', description: null },
			// One description-duplicate group, to verify the `field` parameter
			// actually switches which column is aggregated.
			{
				url: 'https://example.com/d1',
				title: 'D1',
				description: 'Shared description',
			},
			{
				url: 'https://example.com/d2',
				title: 'D2',
				description: 'Shared description',
			},
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
				html: `<html><head><title>${p.title}</title></head></html>`,
				meta: {
					lang: 'ja',
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
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('counts every title-duplicate group, independent of any result-page limit', async () => {
		const total = await countDuplicateGroups(archive, 'title');
		expect(total).toBe(3);
	});

	it('counts description-duplicate groups when field is "description"', async () => {
		const total = await countDuplicateGroups(archive, 'description');
		expect(total).toBe(1);
	});

	it('defaults field to "title" when omitted', async () => {
		const total = await countDuplicateGroups(archive);
		expect(total).toBe(3);
	});

	it('does not count singleton (non-duplicated) values', async () => {
		// 'Unique Title' and 'D1'/'D2' (each title used exactly once) must not
		// inflate the title count above 3.
		const total = await countDuplicateGroups(archive, 'title');
		expect(total).toBe(3);
	});
});
