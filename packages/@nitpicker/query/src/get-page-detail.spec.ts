import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getPageDetail } from './get-page-detail.js';
import { makeBeholderMeta } from './test-helpers/make-beholder-meta.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_get_page_detail__');

describe('getPageDetail', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'get-page-detail-test.nitpicker');

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

		await archive.setPage({
			url: parseUrl('https://example.com/')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 500,
			responseHeaders: { 'X-Frame-Options': 'DENY' },
			html: '<html><head><title>Home</title></head></html>',
			meta: makeBeholderMeta({
				lang: 'ja',
				title: 'Home',
				description: 'Home page',
				keywords: 'test',
				link: { canonical: 'https://example.com/' },
				og: {
					type: 'website',
					title: 'Home OG',
					siteName: 'Example',
					description: 'Home OG desc',
					url: 'https://example.com/',
					image: ['https://example.com/og.png'],
				},
				twitter: { card: 'summary' },
			}),
			anchorList: [
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: 'About us',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/about')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 300,
			responseHeaders: {},
			html: '<html><head><title>About</title></head></html>',
			meta: makeBeholderMeta({ lang: 'ja', title: 'About' }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// A referrer with two separate <a> tags to the same target (e.g. a nav
		// link and a footer link) — must count as one inbound link, not two.
		await archive.setPage({
			url: parseUrl('https://example.com/duplicate-linker')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 300,
			responseHeaders: {},
			html: '<html></html>',
			meta: makeBeholderMeta({ lang: 'ja', title: 'Duplicate linker' }),
			anchorList: [
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: 'About (nav)',
				},
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: 'About (footer)',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		await archive.setConsoleLogs(
			'https://example.com/about',
			[],
			[
				{
					pageUrl: 'https://example.com/about',
					type: 'error',
					text: 'boom',
					args: [],
					ts: 1,
				},
				{
					pageUrl: 'https://example.com/about',
					type: 'log',
					text: 'loaded',
					args: [],
					ts: 2,
				},
			],
		);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('ページの詳細メタデータを返す', async () => {
		const result = await getPageDetail(archive, 'https://example.com');
		expect(result).not.toBeNull();
		expect(result!.url).toBe('https://example.com');
		expect(result!.title).toBe('Home');
		expect(result!.description).toBe('Home page');
		expect(result!.ogTitle).toBe('Home OG');
		expect(result!.twitterCard).toBe('summary');
		expect(result!.status).toBe(200);
		expect(result!.isSkipped).toBe(false);
		expect(result!.skipReason).toBeNull();
	});

	it('除外 (isSkipped) されたページは skipReason を返す', async () => {
		// getPageDetail is the only surface that reports *why* a URL was
		// excluded from crawling (robots.txt / excludeUrls /
		// excludeKeywords) — no list view exposes skip reasons.
		await archive.setSkippedPage('https://example.com/excluded', 'excluded', false);
		const result = await getPageDetail(archive, 'https://example.com/excluded');
		expect(result).not.toBeNull();
		expect(result!.isSkipped).toBe(true);
		expect(result!.skipReason).toBe('excluded');
	});

	it('レスポンスヘッダーをパースして返す', async () => {
		// 0.13: header names are lower-cased by the ref-table decomposition
		// step (`decomposeHeaderSet`) — the original casing captured at crawl
		// time is not preserved.
		const result = await getPageDetail(archive, 'https://example.com');
		expect(result!.responseHeaders).toEqual({ 'x-frame-options': 'DENY' });
	});

	it('アウトバウンドリンクを返す', async () => {
		const result = await getPageDetail(archive, 'https://example.com');
		expect(result!.outboundLinks).toHaveLength(1);
		expect(result!.outboundLinks[0]!.url).toBe('https://example.com/about');
		expect(result!.outboundLinks[0]!.textContent).toBe('About us');
	});

	it('インバウンドリンクを返す', async () => {
		const result = await getPageDetail(archive, 'https://example.com/about');
		const inboundUrls = result!.inboundLinks.map((l) => l.url).toSorted();
		expect(inboundUrls).toEqual([
			'https://example.com',
			'https://example.com/duplicate-linker',
		]);
	});

	it('同一ページから同じ宛先への複数アンカーは1件の被リンクに集約される', async () => {
		const result = await getPageDetail(archive, 'https://example.com/about');
		const fromDuplicateLinker = result!.inboundLinks.filter(
			(l) => l.url === 'https://example.com/duplicate-linker',
		);
		expect(fromDuplicateLinker).toHaveLength(1);
	});

	it('存在しないページは null を返す', async () => {
		const result = await getPageDetail(archive, 'https://example.com/nonexistent');
		expect(result).toBeNull();
	});

	it('captured console logs are returned in ts order (issue #228)', async () => {
		const result = await getPageDetail(archive, 'https://example.com/about');
		expect(result!.consoleLogs.map((e) => ({ type: e.type, text: e.text }))).toEqual([
			{ type: 'error', text: 'boom' },
			{ type: 'log', text: 'loaded' },
		]);
	});

	it('a page with no console logs returns an empty array', async () => {
		const result = await getPageDetail(archive, 'https://example.com');
		expect(result!.consoleLogs).toEqual([]);
	});

	it('page_templates に行がないページは templateKey が null になる', async () => {
		const result = await getPageDetail(archive, 'https://example.com/about');
		expect(result!.templateKey).toBeNull();
	});
});

describe('getPageDetail: templateKey（page_templates の LEFT JOIN）', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_get_page_detail_template_key__');
	const archiveFilePath = path.resolve(dir, 'get-page-detail-template-key.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
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

		await archive.setPage({
			url: parseUrl('https://example.com/')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: makeBeholderMeta({ lang: 'ja', title: 'Home' }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.replacePageTemplates(new Map([['https://example.com', 'template-a']]));
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('page_templates に行があるページは templateKey を返す', async () => {
		const result = await getPageDetail(archive, 'https://example.com');
		expect(result!.templateKey).toBe('template-a');
	});
});

describe('getPageDetail: page_templates テーブル自体が存在しないアーカイブ（--templates 未実行の旧アーカイブ、read-only オープンで自己修復が走らないケースの再現）', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(
		__dirname,
		'__test_fixtures_get_page_detail_no_template_table__',
	);
	const archiveFilePath = path.resolve(
		dir,
		'get-page-detail-no-template-table.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
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

		await archive.setPage({
			url: parseUrl('https://example.com/')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: makeBeholderMeta({ lang: 'ja', title: 'Home' }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Simulates an archive crawled/analyzed before `--templates` shipped:
		// drop the table this connection would otherwise self-heal on the
		// next write-mode open, mirroring a viewer read-only connection that
		// never runs that self-heal at all (see `hasPageTemplatesTable`'s doc).
		await archive.getKnex().schema.dropTable('page_templates');
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('page_templates テーブルが無くても例外を投げず、templateKey は null になる', async () => {
		const result = await getPageDetail(archive, 'https://example.com');
		expect(result).not.toBeNull();
		expect(result!.templateKey).toBeNull();
	});
});

describe('getPageDetail: 被リンクを redirect 越しに解決する（http/https 合算, #71）', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_get_page_detail_redirect__');
	const archiveFilePath = path.resolve(dir, 'page-detail-redirect.nitpicker');

	/**
	 * Minimal empty metadata object shared by the redirect-resolution fixtures.
	 * Avoids repeating the full nullable meta shape in every `setPage` call.
	 */
	const emptyMeta = {
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

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
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

		// 1) Canonical destination — the https content page.
		await archive.setPage({
			url: parseUrl('https://example.com/page')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html><head><title>Page</title></head></html>',
			meta: { ...emptyMeta, title: 'Page' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// 2) http source that 301s to the https destination → http.redirectDestId = https.id.
		await archive.setPage({
			url: parseUrl('http://example.com/page')!,
			redirectPaths: ['https://example.com/page'],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...emptyMeta },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// 3) A page linking the https destination DIRECTLY.
		await archive.setPage({
			url: parseUrl('https://example.com/linker-https')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...emptyMeta },
			anchorList: [
				{
					href: parseUrl('https://example.com/page')!,
					isExternal: false,
					title: null,
					textContent: 'direct https',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// 4) A page linking the http SOURCE (which redirects to the https destination).
		await archive.setPage({
			url: parseUrl('https://example.com/linker-http')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...emptyMeta },
			anchorList: [
				{
					href: parseUrl('http://example.com/page')!,
					isExternal: false,
					title: null,
					textContent: 'via http',
				},
			],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('http リンクと https リンクが宛先ページの被リンクに合算される（分裂しない）', async () => {
		const result = await getPageDetail(archive, 'https://example.com/page');
		const inboundUrls = result!.inboundLinks.map((l) => l.url).toSorted();
		// 直リンク(https) と redirect 元(http)へのリンク、両方が宛先に集約される。
		expect(inboundUrls).toEqual([
			'https://example.com/linker-http',
			'https://example.com/linker-https',
		]);
	});

	it('redirect 元ページの URL で検索しても、宛先ページの詳細（被リンク込み）が返る', async () => {
		// http://example.com/page (redirect 元) で検索した場合も、
		// https://example.com/page (宛先) で検索したのと同じ詳細に解決される —
		// get-page-detail.ts の URL 解決が alias_of_id と同様に redirect_dest_id
		// も辿るため。
		const result = await getPageDetail(archive, 'http://example.com/page');
		expect(result!.url).toBe('https://example.com/page');
		const inboundUrls = result!.inboundLinks.map((l) => l.url).toSorted();
		expect(inboundUrls).toEqual([
			'https://example.com/linker-http',
			'https://example.com/linker-https',
		]);
	});
});

describe('getPageDetail: content_items.alias_of_id handling', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_get_page_detail_alias__');
	const archiveFilePath = path.resolve(dir, 'page-detail-alias.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
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

		// Canonical `/` and its alias `/index.html`.
		await archive.setPage({
			url: parseUrl('https://example.com/')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html><head><title>Home</title></head></html>',
			meta: makeBeholderMeta({ title: 'Home' }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/index.html')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html><head><title>Home</title></head></html>',
			meta: makeBeholderMeta({ title: 'Home' }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		// Links directly at the alias URL — must resolve as an inbound link to
		// the canonical page, same as redirect-source-targeted links do.
		await archive.setPage({
			url: parseUrl('https://example.com/linker')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: makeBeholderMeta({ title: 'Linker' }),
			anchorList: [
				{
					href: parseUrl('https://example.com/index.html')!,
					isExternal: false,
					title: null,
					textContent: 'Home via alias',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		const knex = archive.getKnex();
		const target = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com')
			.first();
		const member = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/index.html')
			.first();
		await knex('content_items').where('id', member.id).update({ alias_of_id: target.id });
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('looking up the alias URL resolves to the canonical page detail', async () => {
		const result = await getPageDetail(archive, 'https://example.com/index.html');
		expect(result!.url).toBe('https://example.com');
	});

	it('lists merged alias URLs on the canonical page detail, regardless of which URL was queried', async () => {
		const byCanonical = await getPageDetail(archive, 'https://example.com');
		const byAlias = await getPageDetail(archive, 'https://example.com/index.html');
		expect(byCanonical!.aliasUrls).toEqual(['https://example.com/index.html']);
		expect(byAlias!.aliasUrls).toEqual(['https://example.com/index.html']);
	});

	it('resolves inbound links targeting the alias URL to the canonical page', async () => {
		const result = await getPageDetail(archive, 'https://example.com');
		const inboundUrls = result!.inboundLinks.map((l) => l.url);
		expect(inboundUrls).toEqual(['https://example.com/linker']);
	});

	it('throws an actionable error when content_items.alias_of_id does not exist', async () => {
		const knex = archive.getKnex();
		await knex.schema.alterTable('content_items', (t) => {
			t.dropColumn('alias_of_id');
		});

		await expect(getPageDetail(archive, 'https://example.com')).rejects.toThrow(
			/viewer-build/,
		);

		// Restore the column so afterAll's close()/other tests are unaffected.
		await knex.schema.alterTable('content_items', (t) => {
			t.integer('alias_of_id');
		});
	});
});
