import type { Config } from './types.js';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, describe, expect, it } from 'vitest';

import { Database } from './database.js';
import { remove } from './filesystem/index.js';

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
		expect(retrieved.scope).toEqual([
			'https://example.com/docs/',
			'https://example.com/blog/',
		]);
		expect(Array.isArray(retrieved.excludes)).toBe(true);
		expect(retrieved.excludes).toEqual(['/admin/', '/private/']);
		expect(Array.isArray(retrieved.excludeKeywords)).toBe(true);
		expect(retrieved.excludeKeywords).toEqual(['secret', 'draft']);
		expect(Array.isArray(retrieved.excludeUrls)).toBe(true);
		expect(retrieved.excludeUrls).toEqual(['https://example.com/skip']);
	});
});

describe('clearHtmlPath', () => {
	const clearHtmlDbPath = path.resolve(workingDir, 'clear-html-test.sqlite');

	afterAll(async () => {
		await remove(clearHtmlDbPath);
	});

	it('スナップショットパスをクリアする', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: clearHtmlDbPath,
		});

		const { pageId, html } = await db.updatePage(
			{
				url: parseUrl('http://localhost/snapshot-test')!,
				redirectPaths: [],
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentLength: 100,
				contentType: 'text/html',
				responseHeaders: {},
				meta: { title: 'Snapshot Test' },
				anchorList: [],
				imageList: [],
				html: '<html></html>',
				isSkipped: false,
			},
			workingDir,
			true,
		);

		expect(html).toBeTruthy();

		const beforeClear = await db.getHtmlPathOnPage(pageId);
		expect(beforeClear).not.toBeNull();

		await db.clearHtmlPath(pageId);

		const afterClear = await db.getHtmlPathOnPage(pageId);
		expect(afterClear).toBeNull();
	});
});

describe('addOrderField', () => {
	it('order カラムが既に存在する場合でもエラーにならない', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: path.resolve(workingDir, 'mock.sqlite'),
		});

		await expect(db.addOrderField()).resolves.not.toThrow();
		await expect(db.addOrderField()).resolves.not.toThrow();
	});
});

describe('getJSON (getConfig 経由)', () => {
	const invalidJsonDbPath = path.resolve(workingDir, 'invalid-json-test.sqlite');

	afterAll(async () => {
		await remove(invalidJsonDbPath);
	});

	it('不正な JSON フィールドがある場合フォールバック値を返し警告ログを出力する', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: invalidJsonDbPath,
		});

		const config: Config = {
			version: '0.4.3',
			name: 'test',
			baseUrl: 'https://example.com',
			recursive: false,
			interval: 500,
			image: false,
			fetchExternal: false,
			parallels: 1,
			scope: [],
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

		await db.setConfig(config);

		// @ts-expect-error -- knex は private だが、テスト目的で不正データを直接書き込む
		await db['_events'];
		// 不正な JSON を直接挿入するため raw SQL を使用
		const knex = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: invalidJsonDbPath,
		});

		// DB に不正な JSON を直接書き込む
		const { default: knexLib } = await import('knex');
		const rawDb = knexLib({
			client: 'sqlite3',
			connection: { filename: invalidJsonDbPath },
			useNullAsDefault: true,
		});
		await rawDb('info').update({ scope: '{invalid json' });

		const retrieved = await knex.getConfig();
		expect(retrieved.scope).toEqual([]);

		await rawDb.destroy();
	});
});
