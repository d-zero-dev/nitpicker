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

		await archive.replacePageTemplates(
			new Map([['https://example.com', 'template-a']]),
			new Map(),
		);
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

describe('getPageDetail: dedupe_cap_events (--dedupe-cap post-hoc marking)', () => {
	let archive: InstanceType<typeof Archive>;
	let eventId: number;
	const dir = path.resolve(__dirname, '__test_fixtures_get_page_detail_dedupe_cap__');
	const archiveFilePath = path.resolve(dir, 'page-detail-dedupe-cap.nitpicker');

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

		for (const url of ['https://example.com/capped', 'https://example.com/not-capped']) {
			await archive.setPage({
				url: parseUrl(url)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html><body>Page</body></html>',
				meta: makeBeholderMeta({ title: 'Page' }),
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		eventId = await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/capped',
			sampleUrl: 'https://example.com/capped',
			bodyHash: Buffer.from('test-body-hash'),
			effectiveThreshold: 8,
			observedCount: 8,
			detectedAt: 1_700_000_000_000,
		});
		const knex = archive.getKnex();
		// A plain `.join().update()` chain silently drops the JOIN when
		// compiled for SQLite (knex has no UPDATE...JOIN support for this
		// dialect); a `whereIn` subquery avoids the join entirely.
		await knex('content_items')
			.whereIn(
				'url_id',
				knex('url_refs').select('id').where('url', 'https://example.com/capped'),
			)
			.update({ dedupe_cap_event_id: eventId });
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('reports isDedupeCapped: true and the capturing shape key for a marked page', async () => {
		const result = await getPageDetail(archive, 'https://example.com/capped');
		expect(result!.isDedupeCapped).toBe(true);
		expect(result!.dedupeCapShapeKey).toBe('example.com/capped');
	});

	it('reports isDedupeCapped: false and a null shape key for an unmarked page', async () => {
		const result = await getPageDetail(archive, 'https://example.com/not-capped');
		expect(result!.isDedupeCapped).toBe(false);
		expect(result!.dedupeCapShapeKey).toBeNull();
	});

	it('reports the capturing dedupeCapEventId for a marked page', async () => {
		const result = await getPageDetail(archive, 'https://example.com/capped');
		expect(result!.dedupeCapEventId).toBe(eventId);
	});

	it('reports a null dedupeCapEventId for an unmarked page', async () => {
		const result = await getPageDetail(archive, 'https://example.com/not-capped');
		expect(result!.dedupeCapEventId).toBeNull();
	});

	it('degrades to isDedupeCapped: false without throwing when the column does not exist (pre-feature archive)', async () => {
		const knex = archive.getKnex();
		await knex.schema.alterTable('content_items', (t) => {
			t.dropColumn('dedupe_cap_event_id');
		});

		const result = await getPageDetail(archive, 'https://example.com/capped');
		expect(result!.isDedupeCapped).toBe(false);
		expect(result!.dedupeCapShapeKey).toBeNull();
		expect(result!.dedupeCapEventId).toBeNull();

		// Restore the column so afterAll's close()/other tests are unaffected.
		await knex.schema.alterTable('content_items', (t) => {
			t.integer('dedupe_cap_event_id');
		});
	});
});
