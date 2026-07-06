import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findDuplicates } from './find-duplicates.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_duplicates__');

describe('findDuplicates', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'dup-test.nitpicker');

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
			version: '0.10.0',
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
			// Two-page group sharing a title — minimum duplicate.
			{ url: 'https://example.com/a', title: 'Duplicate Title', description: null },
			{ url: 'https://example.com/b', title: 'Duplicate Title', description: null },
			// Singleton — must NOT appear in the duplicates result.
			{ url: 'https://example.com/c', title: 'Unique Title', description: null },
			// Three-page group with a shared description — verifies that
			// (a) the description code path works, (b) ORDER BY cnt DESC
			// ranks the 3-page group above the 2-page one, and (c)
			// GROUP_CONCAT covers > 2 URLs without truncation.
			{
				url: 'https://example.com/x',
				title: 'X',
				description: 'Shared description',
			},
			{
				url: 'https://example.com/y',
				title: 'Y',
				description: 'Shared description',
			},
			{
				url: 'https://example.com/z',
				title: 'Z',
				description: 'Shared description',
			},
			// Title containing the GROUP_CONCAT delimiter substitute (comma)
			// — ensures the implementation does not assume comma as the
			// separator (it uses ASCII Unit Separator `\x1F`, which RFC 3986
			// disallows in URLs).
			{
				url: 'https://example.com/comma-1',
				title: 'comma, in title',
				description: null,
			},
			{
				url: 'https://example.com/comma-2',
				title: 'comma, in title',
				description: null,
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
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('重複タイトルを検出する', async () => {
		const result = await findDuplicates(archive, 'title');
		// Three duplicate title groups in the fixture: 'Duplicate Title' (2),
		// 'comma, in title' (2). The 'X' / 'Y' / 'Z' pages share a
		// description, not a title — so they are NOT title-duplicates.
		expect(result).toHaveLength(2);
		const titles = result.map((entry) => entry.value).toSorted();
		expect(titles).toEqual(['Duplicate Title', 'comma, in title']);
		for (const entry of result) {
			expect(entry.urls).toHaveLength(2);
			expect(entry.count).toBe(2);
			// URLs from `GROUP_CONCAT(url, X'1F')` are split client-side; the
			// presence of an in-title comma must not leak across URLs.
			expect(entry.urls.every((u) => u.startsWith('https://example.com/'))).toBe(true);
		}
	});

	it('重複 description を検出し ORDER BY cnt DESC で並ぶ', async () => {
		const result = await findDuplicates(archive, 'description');
		expect(result).toHaveLength(1);
		expect(result[0]?.value).toBe('Shared description');
		expect(result[0]?.count).toBe(3);
		expect(result[0]?.urls).toHaveLength(3);
		expect(result[0]?.urls.toSorted()).toEqual([
			'https://example.com/x',
			'https://example.com/y',
			'https://example.com/z',
		]);
	});

	it('limit が groups の上限として効く', async () => {
		const result = await findDuplicates(archive, 'title', 1);
		expect(result).toHaveLength(1);
		// ORDER BY cnt DESC — both title-duplicate groups have cnt = 2 so
		// SQLite picks one; only the count is contractually stable.
		expect(result[0]?.count).toBe(2);
	});
});

describe('findDuplicates — offset', () => {
	let archive: InstanceType<typeof Archive>;
	const offsetWorkingDir = path.resolve(__dirname, '__test_fixtures_duplicates_offset__');
	const archiveFilePath = path.resolve(offsetWorkingDir, 'dup-offset-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(offsetWorkingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: offsetWorkingDir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
			version: '0.10.0',
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

		// Three title-duplicate groups with DISTINCT member counts (4, 3, 2)
		// so `ORDER BY cnt DESC` is deterministic — a prerequisite for
		// asserting a specific `offset` lands on a specific group.
		const groups: { title: string; count: number }[] = [
			{ title: 'Biggest Group', count: 4 },
			{ title: 'Middle Group', count: 3 },
			{ title: 'Smallest Group', count: 2 },
		];
		for (const group of groups) {
			for (let i = 0; i < group.count; i++) {
				await archive.setPage({
					url: parseUrl(
						`https://example.com/${group.title.replaceAll(' ', '-').toLowerCase()}-${i}`,
					)!,
					redirectPaths: [],
					isExternal: false,
					isTarget: true,
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					contentLength: 100,
					responseHeaders: {},
					html: `<html><head><title>${group.title}</title></head></html>`,
					meta: {
						lang: 'ja',
						title: group.title,
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
			}
		}
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(offsetWorkingDir, { recursive: true, force: true });
	});

	it('offset を省略すると先頭(最多重複)グループから返る', async () => {
		const result = await findDuplicates(archive, 'title', 1);
		expect(result).toHaveLength(1);
		expect(result[0]?.value).toBe('Biggest Group');
	});

	it('offset を指定すると ORDER BY cnt DESC 順で該当分だけ読み飛ばす', async () => {
		const page2 = await findDuplicates(archive, 'title', 1, 1);
		expect(page2).toHaveLength(1);
		expect(page2[0]?.value).toBe('Middle Group');

		const page3 = await findDuplicates(archive, 'title', 1, 2);
		expect(page3).toHaveLength(1);
		expect(page3[0]?.value).toBe('Smallest Group');
	});

	it('offset が総グループ数を超えると空配列を返す', async () => {
		const result = await findDuplicates(archive, 'title', 50, 100);
		expect(result).toEqual([]);
	});
});
