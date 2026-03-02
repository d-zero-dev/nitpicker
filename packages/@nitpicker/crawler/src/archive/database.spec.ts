import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, describe, expect, it } from 'vitest';

import { Database } from './database.js';
import { remove } from './filesystem/index.js';
import type { Config } from './types.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

afterAll(async () => {
	await remove(path.resolve(workingDir, 'tmp.sqlite'));
});

describe('Pages', () => {
	it('insert', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: path.resolve(workingDir, 'tmp.sqlite'),
		});

		await db.updatePage(
			{
				url: parseUrl('http://localhost/path/to')!,
				redirectPaths: [],
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentLength: 1000,
				contentType: 'html/text',
				responseHeaders: {},
				meta: {
					title: 'LOCAL_SERVER',
				},
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
			workingDir,
			true,
		);

		const pages = await db.getPages();

		expect(pages.length).toBe(1);
	});

	it('get', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: path.resolve(workingDir, 'mock.sqlite'),
		});

		const { pages, redirects, anchors, referrers } = await db.getPagesWithRels(0, 2);

		expect(pages.map((p) => p.url)).toEqual([
			'https://localhost/data/one',
			'https://localhost/data/three',
		]);

		expect(pages.map((p) => p.title)).toEqual([
			'DATA ONE | LOCAL_SERVER',
			'DATA THREE | LOCAL_SERVER',
		]);

		expect(redirects).toEqual([
			{
				pageId: 9,
				from: 'https://localhost/data/1',
				fromId: 3,
			},
			{
				pageId: 11,
				from: 'https://localhost/data/3',
				fromId: 5,
			},
		]);

		expect(
			anchors
				.filter((a) => a.pageId === 9)
				.map((a) => ({
					url: a.url,
					href: a.href,
					title: a.title,
					textContent: a.textContent,
				})),
		).toEqual([
			{
				url: 'https://localhost/data/one',
				href: 'https://localhost/data/one',
				title: 'DATA ONE | LOCAL_SERVER',
				textContent: 'DATA ONE',
			},
			{
				url: 'https://localhost/data/two',
				href: 'https://localhost/data/two',
				title: 'DATA TWO | LOCAL_SERVER',
				textContent: 'DATA TWO',
			},
			{
				url: 'https://localhost/data/three',
				href: 'https://localhost/data/three',
				title: 'DATA THREE | LOCAL_SERVER',
				textContent: 'DATA THREE',
			},
			{
				url: 'https://localhost/lp',
				href: 'https://localhost/lp',
				title: '[AD] THE EARTH IS BLUE',
				textContent: 'Advertisement',
			},
			{
				url: 'https://example.com/abc',
				href: 'https://example.com/abc',
				title: 'ABC - example.com',
				textContent: 'ABC',
			},
			{
				url: 'https://example.com/404',
				href: 'https://example.com/xyz',
				title: '404 Not Found - example.com',
				textContent: 'XYZ',
			},
		]);

		expect(referrers.filter((r) => r.pageId === 9)).toEqual([
			{
				pageId: 9,
				url: 'https://localhost/path/to',
				through: 'https://localhost/data/1',
				throughId: 3,
				hash: null,
				textContent: 'DATA-1',
			},
			{
				pageId: 9,
				url: 'https://localhost/data/one',
				through: 'https://localhost/data/one',
				throughId: 9,
				hash: null,
				textContent: 'DATA ONE',
			},
			{
				pageId: 9,
				url: 'https://localhost/data/two',
				through: 'https://localhost/data/one',
				throughId: 9,
				hash: null,
				textContent: 'DATA ONE',
			},
			{
				pageId: 9,
				url: 'https://localhost/data/three',
				through: 'https://localhost/data/one',
				throughId: 9,
				hash: null,
				textContent: 'DATA ONE',
			},
		]);
	});

	it('getPageCount', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: path.resolve(workingDir, 'mock.sqlite'),
		});

		const count = await db.getPageCount();

		expect(count).toEqual(14);
	});
});

describe('Config', () => {
	const configDbPath = path.resolve(workingDir, 'config-test.sqlite');

	afterAll(async () => {
		await remove(configDbPath);
	});

	it('setConfig → getConfig ラウンドトリップで全フィールドが一致する', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: configDbPath,
		});

		const config: Config = {
			version: '0.4.3',
			name: 'test-crawl',
			baseUrl: 'https://example.com',
			recursive: true,
			interval: 500,
			image: true,
			fetchExternal: false,
			parallels: 4,
			scope: ['https://example.com/docs/', 'https://example.com/blog/'],
			excludes: ['/admin/', '/private/'],
			excludeKeywords: ['secret', 'draft'],
			excludeUrls: ['https://example.com/skip'],
			maxExcludedDepth: 3,
			retry: 5,
			fromList: false,
			disableQueries: true,
			userAgent: 'NitpickerBot/1.0',
			ignoreRobots: true,
		};

		await db.setConfig(config);
		const retrieved = await db.getConfig();

		// SQLite はブール値を整数 (0/1) で保存する
		expect(retrieved).toEqual({
			...config,
			recursive: 1,
			image: 1,
			fetchExternal: 0,
			fromList: 0,
			disableQueries: 1,
			ignoreRobots: 1,
		});
	});

	it('Config 型の全キーがスキーマと同期している', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: configDbPath,
		});

		const retrieved = await db.getConfig();

		const expectedKeys: (keyof Config)[] = [
			'version',
			'name',
			'baseUrl',
			'recursive',
			'interval',
			'image',
			'fetchExternal',
			'parallels',
			'scope',
			'excludes',
			'excludeKeywords',
			'excludeUrls',
			'maxExcludedDepth',
			'retry',
			'fromList',
			'disableQueries',
			'userAgent',
			'ignoreRobots',
		];

		for (const key of expectedKeys) {
			expect(retrieved).toHaveProperty(key);
		}
	});

	it('JSON フィールドが正しくシリアライズ/デシリアライズされる', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: configDbPath,
		});

		const retrieved = await db.getConfig();

		expect(Array.isArray(retrieved.scope)).toBe(true);
		expect(retrieved.scope).toEqual(['https://example.com/docs/', 'https://example.com/blog/']);
		expect(Array.isArray(retrieved.excludes)).toBe(true);
		expect(retrieved.excludes).toEqual(['/admin/', '/private/']);
		expect(Array.isArray(retrieved.excludeKeywords)).toBe(true);
		expect(retrieved.excludeKeywords).toEqual(['secret', 'draft']);
		expect(Array.isArray(retrieved.excludeUrls)).toBe(true);
		expect(retrieved.excludeUrls).toEqual(['https://example.com/skip']);
	});
});
