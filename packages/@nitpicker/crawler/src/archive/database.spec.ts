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

	it('getScrapedHtmlPageCount は isTarget=1 かつ scraped=1 のページのみカウントする', async () => {
		const dbPath = path.resolve(workingDir, 'html-count-test.sqlite');
		const db = await Database.connect({
			workingDir,
			filename: dbPath,
		});

		try {
			// scraped=1, isTarget=1 — count される
			await db.updatePage(
				{
					url: parseUrl('http://localhost/page-a')!,
					redirectPaths: [],
					isExternal: false,
					status: 200,
					statusText: 'OK',
					contentLength: 1000,
					contentType: 'text/html',
					responseHeaders: {},
					meta: { title: 'A' },
					anchorList: [],
					imageList: [],
					html: '',
					isSkipped: false,
				},
				workingDir,
				true,
			);
			// scraped=1, isTarget=0 — count されない（非HTMLリソース）
			await db.updatePage(
				{
					url: parseUrl('http://localhost/asset.png')!,
					redirectPaths: [],
					isExternal: false,
					status: 200,
					statusText: 'OK',
					contentLength: 500,
					contentType: 'image/png',
					responseHeaders: {},
					meta: { title: '' },
					anchorList: [],
					imageList: [],
					html: '',
					isSkipped: false,
				},
				workingDir,
				false,
			);
			// scraped=0, isTarget=1 — count されない（pending な target ページ）。
			// `andWhere('scraped', 1)` が誤って `orWhere` になっていると 2 になる。
			// updatePage は scraped=1 で挿入するので、生 knex で直接挿入する。
			await db
				.getKnex()
				.from('pages')
				.insert({ url: 'http://localhost/pending-target', scraped: 0, isTarget: 1 });
			// scraped=0, isTarget=0 — count されない（pending な非target、初期状態）
			await db
				.getKnex()
				.from('pages')
				.insert({ url: 'http://localhost/pending-asset', scraped: 0, isTarget: 0 });

			const count = await db.getScrapedHtmlPageCount();

			expect(count).toBe(1);
		} finally {
			await remove(dbPath);
		}
	});
});

describe('re-scrape: 同一ページの再 updatePage', () => {
	const rescrapeDbPath = path.resolve(workingDir, 'rescrape-dup.sqlite');

	afterAll(async () => {
		await remove(rescrapeDbPath);
	});

	it('2 回 updatePage しても anchors / images は最後の 1 セットだけ残る（重複INSERTしない）', async () => {
		const db = await Database.connect({
			workingDir,
			filename: rescrapeDbPath,
		});

		const pageUrl = 'http://localhost/rescrape-source';
		/**
		 * Builds page data with two anchors and one image for the re-scrape page.
		 * @returns Page data accepted by `Database.updatePage`.
		 */
		const makeData = () => ({
			url: parseUrl(pageUrl)!,
			redirectPaths: [] as string[],
			isExternal: false,
			status: 200,
			statusText: 'OK',
			contentLength: 100,
			contentType: 'text/html',
			responseHeaders: {},
			meta: { title: 'Re-scrape source' },
			anchorList: [
				{
					href: parseUrl('http://localhost/target-a')!,
					textContent: 'A',
					isExternal: false,
				},
				{
					href: parseUrl('http://localhost/target-b')!,
					textContent: 'B',
					isExternal: false,
				},
			],
			imageList: [
				{
					src: 'http://localhost/img.png',
					currentSrc: 'http://localhost/img.png',
					alt: 'img',
					width: 10,
					height: 10,
					naturalWidth: 10,
					naturalHeight: 10,
					isLazy: false,
					viewportWidth: 1200,
					sourceCode: '<img src="img.png">',
				},
			],
			html: '<html></html>',
			isSkipped: false,
		});

		try {
			// 1 回目（初回スクレイプ）と 2 回目（再スクレイプ — 同一 URL）。
			await db.updatePage(makeData(), workingDir, true);
			await db.updatePage(makeData(), workingDir, true);

			const knex = db.getKnex();
			const [page] = await knex.from('pages').select('id').where('url', pageUrl);
			const [anchorRow] = await knex
				.from('anchors')
				.where('pageId', page.id)
				.count({ c: '*' });
			const [imageRow] = await knex
				.from('images')
				.where('pageId', page.id)
				.count({ c: '*' });

			// 再スクレイプは「置き換え」なので、2 セット積み増さず 1 セットだけが残る。
			expect(Number(anchorRow.c)).toBe(2);
			expect(Number(imageRow.c)).toBe(1);
		} finally {
			await db.destroy();
		}
	});

	it('再スクレイプで新しいアンカー集合に置き換わる（古い stale 行は残らない）', async () => {
		const dbPath = path.resolve(workingDir, 'rescrape-replace.sqlite');
		const db = await Database.connect({ workingDir, filename: dbPath });
		const pageUrl = 'http://localhost/replace-source';
		/**
		 * Builds page data linking to the given target slugs.
		 * @param targets - Target path slugs to link to.
		 * @returns Page data accepted by `Database.updatePage`.
		 */
		const makeData = (targets: string[]) => ({
			url: parseUrl(pageUrl)!,
			redirectPaths: [] as string[],
			isExternal: false,
			status: 200,
			statusText: 'OK',
			contentLength: 100,
			contentType: 'text/html',
			responseHeaders: {},
			meta: { title: 'Replace source' },
			anchorList: targets.map((t) => ({
				href: parseUrl(`http://localhost/${t}`)!,
				textContent: t,
				isExternal: false,
			})),
			imageList: [],
			html: '<html></html>',
			isSkipped: false,
		});

		try {
			await db.updatePage(makeData(['target-a', 'target-b']), workingDir, true);
			// 2 回目は target-b を落として target-c を追加。
			await db.updatePage(makeData(['target-a', 'target-c']), workingDir, true);

			const knex = db.getKnex();
			const [page] = await knex.from('pages').select('id').where('url', pageUrl);
			const anchorRows = await knex
				.from('anchors')
				.where('pageId', page.id)
				.select('hrefId');
			const targetPages = await knex
				.from('pages')
				.whereIn(
					'id',
					anchorRows.map((r) => r.hrefId),
				)
				.select('url');
			const hrefs = targetPages.map((p) => p.url).toSorted();

			// 古い target-b は消え、最新の {target-a, target-c} だけが残る。
			expect(hrefs).toEqual(['http://localhost/target-a', 'http://localhost/target-c']);
		} finally {
			await db.destroy();
			await remove(dbPath);
		}
	});

	it('劣化した再スクレイプ（空 anchorList / imageList）は以前の良データを消さない', async () => {
		const dbPath = path.resolve(workingDir, 'rescrape-empty.sqlite');
		const db = await Database.connect({ workingDir, filename: dbPath });
		const pageUrl = 'http://localhost/degraded-source';
		const full = {
			url: parseUrl(pageUrl)!,
			redirectPaths: [] as string[],
			isExternal: false,
			status: 200,
			statusText: 'OK',
			contentLength: 100,
			contentType: 'text/html',
			responseHeaders: {},
			meta: { title: 'Degraded source' },
			anchorList: [
				{
					href: parseUrl('http://localhost/keep-a')!,
					textContent: 'A',
					isExternal: false,
				},
				{
					href: parseUrl('http://localhost/keep-b')!,
					textContent: 'B',
					isExternal: false,
				},
			],
			imageList: [
				{
					src: 'http://localhost/img.png',
					currentSrc: 'http://localhost/img.png',
					alt: 'img',
					width: 10,
					height: 10,
					naturalWidth: 10,
					naturalHeight: 10,
					isLazy: false,
					viewportWidth: 1200,
					sourceCode: '<img src="img.png">',
				},
			],
			html: '<html></html>',
			isSkipped: false,
		};

		try {
			await db.updatePage(full, workingDir, true);
			// 2 回目は空。劣化スクレイプ（タイムアウト/部分描画）と「正当にリンクを
			// 全て失った」ケースは区別できないため、保守的に据え置く（後者では次の
			// 非空スクレイプまで stale が残るのが受容済みの trade-off）。
			await db.updatePage({ ...full, anchorList: [], imageList: [] }, workingDir, true);

			const knex = db.getKnex();
			const [page] = await knex.from('pages').select('id').where('url', pageUrl);
			const [anchorRow] = await knex
				.from('anchors')
				.where('pageId', page.id)
				.count({ c: '*' });
			const [imageRow] = await knex
				.from('images')
				.where('pageId', page.id)
				.count({ c: '*' });

			// 空の再スクレイプでは置き換えず据え置く（#70 修正のデータ損失リグレッション回帰）。
			expect(Number(anchorRow.c)).toBe(2);
			expect(Number(imageRow.c)).toBe(1);
		} finally {
			await db.destroy();
			await remove(dbPath);
		}
	});

	it('コンテンツページがリダイレクト元になった時、旧 anchors を消去する', async () => {
		const dbPath = path.resolve(workingDir, 'rescrape-redirect-source.sqlite');
		const db = await Database.connect({ workingDir, filename: dbPath });
		const oldUrl = 'http://localhost/old-content';

		try {
			// 1) /old-content を 200 コンテンツとしてスクレイプ（アンカーを保存）。
			await db.updatePage(
				{
					url: parseUrl(oldUrl)!,
					redirectPaths: [],
					isExternal: false,
					status: 200,
					statusText: 'OK',
					contentLength: 100,
					contentType: 'text/html',
					responseHeaders: {},
					meta: { title: 'Old content' },
					anchorList: [
						{
							href: parseUrl('http://localhost/stale-x')!,
							textContent: 'X',
							isExternal: false,
						},
					],
					imageList: [],
					html: '<html></html>',
					isSkipped: false,
				},
				workingDir,
				true,
			);

			const knex = db.getKnex();
			const [oldPage] = await knex.from('pages').select('id').where('url', oldUrl);
			const [staleTarget] = await knex
				.from('pages')
				.select('id')
				.where('url', 'http://localhost/stale-x');
			const [before] = await knex
				.from('anchors')
				.where('pageId', oldPage.id)
				.count({ c: '*' });
			expect(Number(before.c)).toBe(1);
			// 症状側の確認: この時点では /old-content は /stale-x の正当な被リンク元。
			const refsBefore = await db.getReferrersOfPage(staleTarget.id);
			expect(refsBefore.map((r) => r.url)).toContain(oldUrl);

			// 2) 後に /old-content が /new-dest へ 301 化（redirectPaths に出現）。
			await db.updatePage(
				{
					url: parseUrl(oldUrl)!,
					redirectPaths: ['http://localhost/new-dest'],
					isExternal: false,
					status: 200,
					statusText: 'OK',
					contentLength: 100,
					contentType: 'text/html',
					responseHeaders: {},
					meta: { title: 'New dest' },
					anchorList: [
						{
							href: parseUrl('http://localhost/dest-link')!,
							textContent: 'D',
							isExternal: false,
						},
					],
					imageList: [],
					html: '<html></html>',
					isSkipped: false,
				},
				workingDir,
				true,
			);

			// /old-content はリダイレクト元になったので旧アンカー(stale-x)は消える。
			const [after] = await knex
				.from('anchors')
				.where('pageId', oldPage.id)
				.count({ c: '*' });
			expect(Number(after.c)).toBe(0);
			// 症状側の回帰: /stale-x の被リンクから幽霊 /old-content が消えていること
			// （referrer 読み取りは redirect 元を除外しないため、根本クリアが必須）。
			const refsAfter = await db.getReferrersOfPage(staleTarget.id);
			expect(refsAfter.map((r) => r.url)).not.toContain(oldUrl);
		} finally {
			await db.destroy();
			await remove(dbPath);
		}
	});

	it('ページ内に正当な同一リンク（ヘッダー/フッター重複）がある場合、再スクレイプでも件数を保持する', async () => {
		// 実アーカイブの「重複」の大半は、全ページのヘッダー/フッターに同じリンクが
		// 並ぶ正当なページ内重複。delete-then-insert は anchorList をそのまま入れ直す
		// ので、この正当な重複を潰さず（tuple-dedup しない）、かつ再スクレイプで増やさない。
		const dbPath = path.resolve(workingDir, 'rescrape-intrapage-dup.sqlite');
		const db = await Database.connect({ workingDir, filename: dbPath });
		const pageUrl = 'http://localhost/intra-dup-source';
		/**
		 * Builds page data where the same link appears twice (header + footer).
		 * @returns Page data accepted by `Database.updatePage`.
		 */
		const makeData = () => ({
			url: parseUrl(pageUrl)!,
			redirectPaths: [] as string[],
			isExternal: false,
			status: 200,
			statusText: 'OK',
			contentLength: 100,
			contentType: 'text/html',
			responseHeaders: {},
			meta: { title: 'Intra-page dup' },
			anchorList: [
				{
					href: parseUrl('http://localhost/ir')!,
					textContent: '株主・投資家',
					isExternal: false,
				},
				// ヘッダーとフッターで同一の href + textContent（正当な重複）。
				{
					href: parseUrl('http://localhost/ir')!,
					textContent: '株主・投資家',
					isExternal: false,
				},
				{
					href: parseUrl('http://localhost/other')!,
					textContent: 'その他',
					isExternal: false,
				},
			],
			imageList: [],
			html: '<html></html>',
			isSkipped: false,
		});

		try {
			await db.updatePage(makeData(), workingDir, true);
			await db.updatePage(makeData(), workingDir, true);

			const knex = db.getKnex();
			const [page] = await knex.from('pages').select('id').where('url', pageUrl);
			const [row] = await knex.from('anchors').where('pageId', page.id).count({ c: '*' });

			// 正当なページ内重複(2) + 別リンク(1) = 3 を保持。
			// tuple-dedup なら 2 に減り、accumulation バグなら 6 に増える。
			expect(Number(row.c)).toBe(3);
		} finally {
			await db.destroy();
			await remove(dbPath);
		}
	});

	it('複数の異なる URL が同じ宛先にリダイレクトしても宛先アンカーは1セットに収束する（#70 の実機構）', async () => {
		// 実アーカイブの真の重複バグ: N 個の旧 URL が同じ宛先 D に 301 し、クローラが
		// ソースごとに D を取得して D のアンカーを N 回保存していた。delete-then-insert
		// で D のアンカーは常に最新 1 セットに収束する。
		const dbPath = path.resolve(workingDir, 'rescrape-redirect-converge.sqlite');
		const db = await Database.connect({ workingDir, filename: dbPath });
		const dest = 'http://localhost/archive-index';
		/**
		 * Builds page data for a source URL that 301-redirects to the shared dest.
		 * @param sourceUrl - The redirecting source URL.
		 * @returns Page data accepted by `Database.updatePage`.
		 */
		const makeData = (sourceUrl: string) => ({
			url: parseUrl(sourceUrl)!,
			redirectPaths: [dest],
			isExternal: false,
			status: 200,
			statusText: 'OK',
			contentLength: 100,
			contentType: 'text/html',
			responseHeaders: {},
			meta: { title: 'Archive index' },
			anchorList: [
				{ href: parseUrl('http://localhost/x')!, textContent: 'X', isExternal: false },
				{ href: parseUrl('http://localhost/y')!, textContent: 'Y', isExternal: false },
			],
			imageList: [],
			html: '<html></html>',
			isSkipped: false,
		});

		try {
			// 3 個の異なる旧 URL がすべて D にリダイレクト。
			await db.updatePage(makeData('http://localhost/old-1'), workingDir, true);
			await db.updatePage(makeData('http://localhost/old-2'), workingDir, true);
			await db.updatePage(makeData('http://localhost/old-3'), workingDir, true);

			const knex = db.getKnex();
			const [destPage] = await knex.from('pages').select('id').where('url', dest);
			const [row] = await knex
				.from('anchors')
				.where('pageId', destPage.id)
				.count({ c: '*' });

			// 3 回集約しても D のアンカーは 1 セット(2)。修正前は 6 に膨張していた。
			expect(Number(row.c)).toBe(2);
		} finally {
			await db.destroy();
			await remove(dbPath);
		}
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

		const scope = new Map([
			['other.example.com', [parseUrl('https://other.example.com/')!]],
		]);
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
