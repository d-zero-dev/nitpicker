import type { Config } from './types.js';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, describe, expect, it } from 'vitest';

import { Database } from './database.js';
import { remove } from './filesystem/remove.js';
import { LibsqlDialect } from './libsql-dialect.js';

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

describe('self-redirect', () => {
	const selfRedirectDbPath = path.resolve(workingDir, 'self-redirect-test.sqlite');

	afterAll(async () => {
		await remove(selfRedirectDbPath);
	});

	it('自己リダイレクト（元URL=先URL）は redirectDestId を設定しない', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: selfRedirectDbPath,
		});

		// redirectPaths の最後が最終行き先。元URLと同じURLへのリダイレクト。
		await db.updatePage(
			{
				url: parseUrl('https://example.com/page')!,
				redirectPaths: ['https://example.com/page'],
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentLength: 100,
				contentType: 'text/html',
				responseHeaders: {},
				meta: { title: 'Self Redirect Page' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
			null,
			true,
		);

		const pages = await db.getPages();
		const page = pages.find((p) => p.url === 'https://example.com/page');
		expect(page).toBeDefined();
		expect(page!.redirectDestId).toBeNull();
	});

	it('A→B→A の循環リダイレクトでは中間の B のみ redirectDestId が設定される', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: selfRedirectDbPath,
		});

		// follow-redirects が返す redirectPaths: [B, A]
		// updatePage 内で destUrl=A(pop), redirectPaths=[A(unshift), B]
		// A===A → skip, B!==A → set
		await db.updatePage(
			{
				url: parseUrl('https://example.com/circular')!,
				redirectPaths: ['https://example.com/mid', 'https://example.com/circular'],
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentLength: 100,
				contentType: 'text/html',
				responseHeaders: {},
				meta: { title: 'Circular Redirect' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
			null,
			true,
		);

		const pages = await db.getPages();
		const pageA = pages.find((p) => p.url === 'https://example.com/circular');
		const pageB = pages.find((p) => p.url === 'https://example.com/mid');
		expect(pageA).toBeDefined();
		expect(pageB).toBeDefined();
		expect(pageA!.redirectDestId).toBeNull();
		expect(pageB!.redirectDestId).toBe(pageA!.id);
	});

	it('通常のリダイレクト（A→B）は redirectDestId が正しく設定される', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: selfRedirectDbPath,
		});

		await db.updatePage(
			{
				url: parseUrl('https://example.com/old-page')!,
				redirectPaths: ['https://example.com/new-page'],
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentLength: 100,
				contentType: 'text/html',
				responseHeaders: {},
				meta: { title: 'Normal Redirect' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
			null,
			true,
		);

		const pages = await db.getPages();
		const oldPage = pages.find((p) => p.url === 'https://example.com/old-page');
		const newPage = pages.find((p) => p.url === 'https://example.com/new-page');
		expect(oldPage).toBeDefined();
		expect(newPage).toBeDefined();
		expect(oldPage!.redirectDestId).toBe(newPage!.id);
	});

	it('末尾スラッシュの有無が異なるリダイレクトは自己リダイレクトとみなさない', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: selfRedirectDbPath,
		});

		// /trailing → /trailing/ は異なる URL なので通常のリダイレクトとして扱う
		await db.updatePage(
			{
				url: parseUrl('https://example.com/trailing')!,
				redirectPaths: ['https://example.com/trailing/'],
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentLength: 100,
				contentType: 'text/html',
				responseHeaders: {},
				meta: { title: 'Trailing Slash Redirect' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
			null,
			true,
		);

		const pages = await db.getPages();
		const srcPage = pages.find((p) => p.url === 'https://example.com/trailing');
		const destPage = pages.find((p) => p.url === 'https://example.com/trailing/');
		expect(srcPage).toBeDefined();
		expect(destPage).toBeDefined();
		expect(srcPage!.redirectDestId).toBe(destPage!.id);
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
	const addOrderDbPath = path.resolve(workingDir, 'add-order-test.sqlite');

	afterAll(async () => {
		await remove(addOrderDbPath);
	});

	it('order カラムが既に存在する場合でもエラーにならない', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: path.resolve(workingDir, 'mock.sqlite'),
		});

		// 2回連続で呼んでも例外が発生しない
		await db.addOrderField();
		await db.addOrderField();

		const pages = await db.getPages();
		expect(pages[0]).toHaveProperty('order');
	});

	it('order カラムが存在しない場合に追加される', async () => {
		const db = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: addOrderDbPath,
		});

		await db.updatePage(
			{
				url: parseUrl('http://localhost/order-test')!,
				redirectPaths: [],
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentLength: 100,
				contentType: 'text/html',
				responseHeaders: {},
				meta: { title: 'Order Test' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
			null,
			true,
		);

		const pages = await db.getPages();
		expect(pages[0]).toHaveProperty('order');
		expect(pages[0]!.order).toBeNull();
	});
});

describe('getJSON (getConfig 経由)', () => {
	const invalidJsonDbPath = path.resolve(workingDir, 'invalid-json-test.sqlite');

	afterAll(async () => {
		await remove(invalidJsonDbPath);
	});

	it('不正な JSON フィールドがある場合フォールバック値を返す', async () => {
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
		await db.destroy();

		// DB に不正な JSON を直接書き込む
		const { default: knexLib } = await import('knex');
		const rawDb = knexLib({
			client: LibsqlDialect,
			connection: { filename: invalidJsonDbPath },
			useNullAsDefault: true,
		});
		await rawDb('info').update({ scope: '{invalid json' });
		await rawDb.destroy();

		const db2 = await Database.connect({
			type: 'sqlite3',
			workingDir,
			filename: invalidJsonDbPath,
		});

		const retrieved = await db2.getConfig();
		expect(retrieved.scope).toEqual([]);

		await db2.destroy();
	});
});
