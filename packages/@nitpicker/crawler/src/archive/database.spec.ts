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
			workingDir,
			filename: configDbPath,
		});

		const config: Config = {
			version: '0.4.3',
			name: 'test-crawl',
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			recursive: true,
			interval: 500,
			image: true,
			fetchExternal: false,
			parallels: 4,
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
			workingDir,
			filename: configDbPath,
		});

		const retrieved = await db.getConfig();

		const expectedKeys: (keyof Config)[] = [
			'version',
			'name',
			'baseUrl',
			'roots',
			'recursive',
			'interval',
			'image',
			'fetchExternal',
			'parallels',
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
			workingDir,
			filename: configDbPath,
		});

		const retrieved = await db.getConfig();

		expect(Array.isArray(retrieved.roots)).toBe(true);
		expect(retrieved.roots).toEqual(['https://example.com']);
		expect(Array.isArray(retrieved.excludes)).toBe(true);
		expect(retrieved.excludes).toEqual(['/admin/', '/private/']);
		expect(Array.isArray(retrieved.excludeKeywords)).toBe(true);
		expect(retrieved.excludeKeywords).toEqual(['secret', 'draft']);
		expect(Array.isArray(retrieved.excludeUrls)).toBe(true);
		expect(retrieved.excludeUrls).toEqual(['https://example.com/skip']);
	});

	it('updateConfig overwrites only the specified fields and serialises JSON arrays', async () => {
		const db = await Database.connect({
			workingDir,
			filename: configDbPath,
		});

		// roots だけ上書き、他は触らない
		await db.updateConfig({
			roots: ['https://example.com/', 'https://example.com/blog/'],
		});

		const after = await db.getConfig();
		expect(after.roots).toEqual(['https://example.com/', 'https://example.com/blog/']);
		// 他のフィールドは変わっていない
		expect(after.baseUrl).toBe('https://example.com');
		expect(after.name).toBe('test-crawl');
		expect(after.parallels).toBe(4);
		expect(after.userAgent).toBe('NitpickerBot/1.0');
	});

	it('updateConfig with an empty patch is a no-op', async () => {
		const db = await Database.connect({
			workingDir,
			filename: configDbPath,
		});

		const before = await db.getConfig();
		await db.updateConfig({});
		const after = await db.getConfig();
		expect(after).toEqual(before);
	});

	it('setConfig silently drops keys outside the info-column allowlist', async () => {
		const dropDbPath = path.resolve(workingDir, 'set-config-drop.sqlite');
		const { rmSync } = await import('node:fs');
		rmSync(dropDbPath, { force: true });
		const db = await Database.connect({
			workingDir,
			filename: dropDbPath,
		});

		// `cwd` is a CrawlConfig-only runtime field with no matching info column.
		// Splatting a wider object must not throw "no such column: cwd".
		const wider = {
			version: '0.4.3',
			name: 'allowlist-drop',
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			recursive: true,
			interval: 0,
			image: false,
			fetchExternal: false,
			parallels: 1,
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 0,
			fromList: false,
			disableQueries: false,
			userAgent: 'x',
			ignoreRobots: false,
			cwd: '/tmp/should-not-leak',
		};
		await expect(db.setConfig(wider as never)).resolves.not.toThrow();
		const retrieved = await db.getConfig();
		expect(retrieved).not.toHaveProperty('cwd');
		expect(retrieved.name).toBe('allowlist-drop');

		await db.destroy();
		rmSync(dropDbPath, { force: true });
	});

	it('updateConfig silently drops keys outside the info-column allowlist', async () => {
		const db = await Database.connect({
			workingDir,
			filename: configDbPath,
		});

		const before = await db.getConfig();
		// Same hazard as the setConfig allowlist test: a CrawlConfig spread can
		// reach updateConfig with extras like `cwd` and must not throw.
		await expect(
			db.updateConfig({ cwd: '/tmp/should-not-leak' } as never),
		).resolves.not.toThrow();
		const after = await db.getConfig();
		expect(after).toEqual(before);
		expect(after).not.toHaveProperty('cwd');
	});
});

describe('repromoteExternalPages', () => {
	const repromoteDbPath = path.resolve(workingDir, 'repromote-test.sqlite');

	afterAll(async () => {
		await remove(repromoteDbPath);
	});

	it('demotes-back hostname-matching external pages whose path is inside the new scope', async () => {
		const db = await Database.connect({
			workingDir,
			filename: repromoteDbPath,
		});

		// 外部として保存された 2 ページ: /blog/ 下と、scope 外の /marketing/about
		await db.updatePage(
			{
				url: parseUrl('https://example.com/blog/post-1')!,
				redirectPaths: [],
				isExternal: true,
				status: 200,
				statusText: 'OK',
				contentLength: 100,
				contentType: 'text/html',
				responseHeaders: {},
				meta: { title: 'Blog 1' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
			null,
			false,
		);
		await db.updatePage(
			{
				url: parseUrl('https://example.com/marketing/about')!,
				redirectPaths: [],
				isExternal: true,
				status: 200,
				statusText: 'OK',
				contentLength: 100,
				contentType: 'text/html',
				responseHeaders: {},
				meta: { title: 'Marketing' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
			null,
			false,
		);

		const scope = new Map([['example.com', [parseUrl('https://example.com/blog/')!]]]);
		const promoted = await db.repromoteExternalPages(scope);

		expect(promoted).toEqual(['https://example.com/blog/post-1']);

		// repromote は contentType を null にクリアするため、filter なしで全件取得して確認
		const all = await db.getPages();
		const blog = all.find((p) => p.url === 'https://example.com/blog/post-1')!;
		const marketing = all.find((p) => p.url === 'https://example.com/marketing/about')!;

		// repromote 対象は scraped=0 に戻り isExternal=0 に、scrape メタデータもクリアされる
		expect(blog.scraped).toBe(0);
		expect(blog.isExternal).toBe(0);
		expect(blog.contentType).toBeNull();
		expect(blog.status).toBeNull();
		expect(blog.html).toBeNull();
		// scope 外の同一ホスト external は影響なし
		expect(marketing.isExternal).toBe(1);
		expect(marketing.contentType).toBe('text/html');
	});

	it('does not touch any page when no external row is inside the new scope', async () => {
		const db = await Database.connect({
			workingDir,
			filename: repromoteDbPath,
		});

		const scope = new Map([['other.com', [parseUrl('https://other.com/')!]]]);
		const promoted = await db.repromoteExternalPages(scope);
		expect(promoted).toEqual([]);
	});

	it('repromote 対象 page に紐付く anchors / images / resources-referrers を削除する', async () => {
		const cleanDbPath = path.resolve(workingDir, 'repromote-cleanup.sqlite');
		const { rmSync } = await import('node:fs');
		rmSync(cleanDbPath, { force: true });
		const db = await Database.connect({
			workingDir,
			filename: cleanDbPath,
		});

		// 2 ページを external として保存 (1 つは scope に該当, 1 つは外)
		await db.updatePage(
			{
				url: parseUrl('https://example.com/blog/post-1')!,
				redirectPaths: [],
				isExternal: true,
				status: 200,
				statusText: 'OK',
				contentLength: 100,
				contentType: 'text/html',
				responseHeaders: {},
				meta: { title: 'Blog' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
			null,
			false,
		);
		await db.updatePage(
			{
				url: parseUrl('https://example.com/marketing/about')!,
				redirectPaths: [],
				isExternal: true,
				status: 200,
				statusText: 'OK',
				contentLength: 100,
				contentType: 'text/html',
				responseHeaders: {},
				meta: { title: 'Marketing' },
				anchorList: [],
				imageList: [],
				html: '',
				isSkipped: false,
			},
			null,
			false,
		);

		// repromote 対象 (blog) と非対象 (marketing) の page id を取得
		const allBefore = await db.getPages();
		const blogId = allBefore.find((p) => p.url === 'https://example.com/blog/post-1')!.id;
		const marketingId = allBefore.find(
			(p) => p.url === 'https://example.com/marketing/about',
		)!.id;

		// 関連テーブルに直接 INSERT して repromote 対象 page と非対象 page の両方に
		// anchors / images / resources-referrers の行があることを保証する
		const knex = db.getKnex();
		await knex('anchors').insert([
			{ pageId: blogId, hrefId: marketingId, hash: null, textContent: 'to marketing' },
			{ pageId: marketingId, hrefId: blogId, hash: null, textContent: 'to blog' },
		]);
		await knex('images').insert([
			{
				pageId: blogId,
				src: 'https://example.com/blog/img.png',
				currentSrc: null,
				alt: null,
				width: 100,
				height: 100,
				naturalWidth: 100,
				naturalHeight: 100,
				isLazy: 0,
				viewportWidth: 1024,
				sourceCode: null,
			},
			{
				pageId: marketingId,
				src: 'https://example.com/marketing/img.png',
				currentSrc: null,
				alt: null,
				width: 100,
				height: 100,
				naturalWidth: 100,
				naturalHeight: 100,
				isLazy: 0,
				viewportWidth: 1024,
				sourceCode: null,
			},
		]);
		const [resourceId] = await knex('resources')
			.insert({ url: 'https://cdn.example.com/x.css', isExternal: 1 })
			.returning('id');
		const rid = Number(
			typeof resourceId === 'object' ? (resourceId as { id: number }).id : resourceId,
		);
		await knex('resources-referrers').insert([
			{ resourceId: rid, pageId: blogId },
			{ resourceId: rid, pageId: marketingId },
		]);

		// scope: /blog/ 下のみ
		const scope = new Map([['example.com', [parseUrl('https://example.com/blog/')!]]]);
		const promoted = await db.repromoteExternalPages(scope);
		expect(promoted).toEqual(['https://example.com/blog/post-1']);

		// repromote 対象 (blog) の関連行は全削除
		const anchorsForBlog = await knex('anchors').where('pageId', blogId);
		expect(anchorsForBlog).toEqual([]);
		const imagesForBlog = await knex('images').where('pageId', blogId);
		expect(imagesForBlog).toEqual([]);
		const referrersForBlog = await knex('resources-referrers').where('pageId', blogId);
		expect(referrersForBlog).toEqual([]);

		// 非対象 (marketing) の関連行はそのまま残る
		const anchorsForMarketing = await knex('anchors').where('pageId', marketingId);
		expect(anchorsForMarketing).toHaveLength(1);
		const imagesForMarketing = await knex('images').where('pageId', marketingId);
		expect(imagesForMarketing).toHaveLength(1);
		const referrersForMarketing = await knex('resources-referrers').where(
			'pageId',
			marketingId,
		);
		expect(referrersForMarketing).toHaveLength(1);

		await db.destroy();
		rmSync(cleanDbPath, { force: true });
	});

	it('returns an empty list when the scope map has no entries', async () => {
		const db = await Database.connect({
			workingDir,
			filename: repromoteDbPath,
		});

		const promoted = await db.repromoteExternalPages(new Map());
		expect(promoted).toEqual([]);
	});

	it('repromotes every match when the candidate set straddles the 500-row chunk boundary', async () => {
		// Verifies the implementation chunks SELECT / UPDATE / DELETE in
		// fixed-size batches (chunkSize=500). 501 candidates → 2 chunks.
		const chunkDbPath = path.resolve(workingDir, 'repromote-chunk.sqlite');
		const { rmSync } = await import('node:fs');
		rmSync(chunkDbPath, { force: true });
		const db = await Database.connect({
			workingDir,
			filename: chunkDbPath,
		});

		const total = 501;
		for (let i = 0; i < total; i++) {
			await db.updatePage(
				{
					url: parseUrl(`https://example.com/blog/post-${i}`)!,
					redirectPaths: [],
					isExternal: true,
					status: 200,
					statusText: 'OK',
					contentLength: 1,
					contentType: 'text/html',
					responseHeaders: {},
					meta: { title: `t-${i}` },
					anchorList: [],
					imageList: [],
					html: '',
					isSkipped: false,
				},
				null,
				false,
			);
		}

		const scope = new Map([['example.com', [parseUrl('https://example.com/blog/')!]]]);
		const promoted = await db.repromoteExternalPages(scope);

		expect(promoted).toHaveLength(total);

		const remainingExternal = await db
			.getKnex()
			.from('pages')
			.where('isExternal', 1)
			.count<{ c: number }[]>({ c: '*' });
		expect(Number(remainingExternal[0]!.c)).toBe(0);

		await db.destroy();
		rmSync(chunkDbPath, { force: true });
	});
});

describe('self-redirect', () => {
	const selfRedirectDbPath = path.resolve(workingDir, 'self-redirect-test.sqlite');

	afterAll(async () => {
		await remove(selfRedirectDbPath);
	});

	it('自己リダイレクト（元URL=先URL）は redirectDestId を設定しない', async () => {
		const db = await Database.connect({
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
			workingDir,
			filename: invalidJsonDbPath,
		});

		const config: Config = {
			version: '0.4.3',
			name: 'test',
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			recursive: false,
			interval: 500,
			image: false,
			fetchExternal: false,
			parallels: 1,
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
		await rawDb('info').update({ excludes: '{invalid json' });
		await rawDb.destroy();

		const db2 = await Database.connect({
			workingDir,
			filename: invalidJsonDbPath,
		});

		const retrieved = await db2.getConfig();
		expect(retrieved.excludes).toEqual([]);

		await db2.destroy();
	});
});

describe('insertPageError', () => {
	const dbPath = path.resolve(workingDir, 'page-errors-test.sqlite');

	afterAll(async () => {
		await remove(dbPath);
	});

	it('records a page_errors row keyed to the page even if the page is not scraped yet', async () => {
		const db = await Database.connect({
			workingDir,
			filename: dbPath,
		});

		// The orchestrator may write the page error BEFORE setPage runs;
		// insertPageError must therefore upsert the page row on demand.
		await db.insertPageError(
			'https://example.com/wedged-viewport',
			'retryExhausted',
			'📷 mobile-small: skipped — Attempted to use detached Frame',
		);

		const knex = db.getKnex();
		const rows = await knex('page_errors').select('phase', 'message');
		expect(rows).toEqual([
			{
				phase: 'retryExhausted',
				message: '📷 mobile-small: skipped — Attempted to use detached Frame',
			},
		]);

		const pages = await knex('pages').select('url', 'scraped');
		expect(pages).toEqual([{ url: 'https://example.com/wedged-viewport', scraped: 0 }]);
	});

	it('appends a second row when the same URL fails for another phase', async () => {
		const db = await Database.connect({
			workingDir,
			filename: dbPath,
		});

		await db.insertPageError(
			'https://example.com/wedged-viewport',
			'retryExhausted',
			'📷 desktop-compact: skipped — Session closed',
		);

		const knex = db.getKnex();
		const rows = await knex('page_errors').select('phase', 'message').orderBy('id');
		expect(rows).toHaveLength(2);
		expect(rows[1]).toEqual({
			phase: 'retryExhausted',
			message: '📷 desktop-compact: skipped — Session closed',
		});
	});

	it('flags the page row as external when isExternal is true', async () => {
		const db = await Database.connect({
			workingDir,
			filename: dbPath,
		});

		await db.insertPageError(
			'https://external.example.com/oops',
			'retryExhausted',
			'oops',
			true,
		);

		const knex = db.getKnex();
		const [row] = await knex('pages')
			.where('url', 'https://external.example.com/oops')
			.select('isExternal');
		expect(row.isExternal).toBe(1);
	});
});

describe('getResourceByUrl', () => {
	const resourceDbPath = path.resolve(workingDir, 'get-resource-by-url-test.sqlite');

	afterAll(async () => {
		await remove(resourceDbPath);
	});

	it('挿入したリソースをURLで取得できる・未登録URLは null', async () => {
		const db = await Database.connect({
			workingDir,
			filename: resourceDbPath,
		});

		await db.insertResource({
			url: parseUrl('https://example.com/image.jpg')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'image/jpeg',
			contentLength: 1234,
			compress: false,
			cdn: false,
			headers: { 'content-type': 'image/jpeg' },
		});

		const hit = await db.getResourceByUrl(['https://example.com/image.jpg']);
		expect(hit).not.toBeNull();
		expect(hit?.status).toBe(200);
		expect(hit?.statusText).toBe('OK');
		expect(hit?.contentType).toBe('image/jpeg');
		expect(hit?.contentLength).toBe(1234);
		expect(hit?.responseHeaders).toBe(JSON.stringify({ 'content-type': 'image/jpeg' }));

		// 複数候補のうちいずれかが一致すればヒットする
		const hitByCandidates = await db.getResourceByUrl([
			'https://example.com/no-such.jpg',
			'https://example.com/image.jpg',
		]);
		expect(hitByCandidates?.url).toBe('https://example.com/image.jpg');

		const miss = await db.getResourceByUrl(['https://example.com/no-such.jpg']);
		expect(miss).toBeNull();

		await db.destroy();
	});
});
