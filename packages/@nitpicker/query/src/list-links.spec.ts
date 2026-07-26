import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listLinks } from './list-links.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_links__');

describe('listLinks', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'list-links-test.nitpicker');

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

		// Home page links to About and Broken
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
			meta: {
				lang: null,
				title: 'Home',
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
			anchorList: [
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: 'About',
				},
				{
					href: parseUrl('https://example.com/broken')!,
					isExternal: false,
					title: null,
					textContent: 'Broken link',
				},
				{
					href: parseUrl('https://example.com/forbidden')!,
					isExternal: false,
					title: null,
					textContent: 'Forbidden link',
				},
				{
					href: parseUrl('https://example.com/server-error')!,
					isExternal: false,
					title: null,
					textContent: 'Server error link',
				},
				{
					href: parseUrl('https://example.com/excluded')!,
					isExternal: false,
					title: null,
					textContent: 'Excluded link',
				},
				{
					href: parseUrl('https://example.net/')!,
					isExternal: true,
					title: null,
					textContent: 'External',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// About page (has incoming link from Home)
		await archive.setPage({
			url: parseUrl('https://example.com/about')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: {
				lang: null,
				title: 'About',
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

		// Broken page (404)
		await archive.setPage({
			url: parseUrl('https://example.com/broken')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: {
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Forbidden page (403) — access denied, not a broken link.
		await archive.setPage({
			url: parseUrl('https://example.com/forbidden')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 403,
			statusText: 'Forbidden',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: {
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Server error page (500) — infra concern, tracked separately from broken links.
		await archive.setPage({
			url: parseUrl('https://example.com/server-error')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 500,
			statusText: 'Internal Server Error',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: {
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Excluded page (robots.txt / excludeUrls) — never fetched, status stays
		// NULL. Must not be misreported as a broken link.
		await archive.setSkippedPage('https://example.com/excluded', 'excluded', false);

		// External page
		await archive.setPage({
			url: parseUrl('https://example.net/')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: {
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('404 の broken リンクのみを検出する', async () => {
		const result = await listLinks(archive, { type: 'broken' });
		expect(result.items.length).toBe(1);
		const broken = result.items[0];
		expect(broken).toMatchObject({
			destUrl: 'https://example.com/broken',
			sourceUrl: 'https://example.com',
			status: 404,
		});
	});

	it('403 (Forbidden) は broken リンクとして扱わない', async () => {
		const result = await listLinks(archive, { type: 'broken' });
		expect(
			result.items.some((item) => item.destUrl === 'https://example.com/forbidden'),
		).toBe(false);
	});

	it('5xx (サーバーエラー) は broken リンクとして扱わない', async () => {
		const result = await listLinks(archive, { type: 'broken' });
		expect(
			result.items.some((item) => item.destUrl === 'https://example.com/server-error'),
		).toBe(false);
	});

	it('除外 (isSkipped) された未取得ページは broken リンクとして扱わない', async () => {
		const result = await listLinks(archive, { type: 'broken' });
		expect(
			result.items.some((item) => item.destUrl === 'https://example.com/excluded'),
		).toBe(false);
	});

	it('external リンクを検出する', async () => {
		const result = await listLinks(archive, { type: 'external' });
		expect(result.items.length).toBe(1);
		expect(result.items[0]).toMatchObject({
			destUrl: 'https://example.net',
			sourceUrl: 'https://example.com',
			isExternal: true,
		});
	});

	it('status でリンク先をフィルタする', async () => {
		const result = await listLinks(archive, { type: 'external', status: 404 });
		expect(result.items).toHaveLength(0);
		expect(result.total).toBe(0);
	});

	it('ページネーションが機能する', async () => {
		const result = await listLinks(archive, { type: 'broken', limit: 1, offset: 0 });
		expect(result.items).toHaveLength(1);
	});
});

/**
 * Separate describe with a dedicated fixture: an anchor that points at a
 * redirect-source URL whose canonical destination is broken (404). This
 * pins the redirect-resolved broken/external judgment — listLinks folds
 * anchors to their canonical (redirect-resolved) destination by default.
 */
describe('listLinks — redirect resolution', () => {
	let archive: InstanceType<typeof Archive>;
	const redirectWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_list_links_redirect__',
	);
	const redirectArchiveFilePath = path.resolve(
		redirectWorkingDir,
		'list-links-redirect-test.nitpicker',
	);

	const META = {
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
		mkdirSync(redirectWorkingDir, { recursive: true });
		archive = await Archive.create({
			filePath: redirectArchiveFilePath,
			cwd: redirectWorkingDir,
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

		// Source page with anchor to /old (a redirect-source pointing at /404-canonical).
		await archive.setPage({
			url: parseUrl('https://example.com/source')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Source' },
			anchorList: [
				{
					href: parseUrl('https://example.com/old')!,
					isExternal: false,
					title: null,
					textContent: 'Old',
					hash: null,
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// Canonical destination: 404 (broken).
		await archive.setPage({
			url: parseUrl('https://example.com/404-canonical')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Record /old → /404-canonical redirect.
		await archive.setRedirect({
			url: parseUrl('https://example.com/old')!,
			redirectPaths: ['https://example.com/404-canonical'],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(redirectWorkingDir, { recursive: true, force: true });
	});

	it('reports the canonical destination URL + status for broken anchors via redirect chain', async () => {
		const result = await listLinks(archive, { type: 'broken' });
		// One anchor: /source → /old (redirect-source) → /404-canonical.
		// Broken judgment uses canonical status (404), and `destUrl` reports
		// the canonical URL — not the literal redirect-source.
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			sourceUrl: 'https://example.com/source',
			destUrl: 'https://example.com/404-canonical',
			status: 404,
		});
	});

	it('includeRedirectSources=true reports literal dest (the 301 intermediate)', async () => {
		const result = await listLinks(archive, {
			type: 'broken',
			includeRedirectSources: true,
		});
		// With resolution disabled, the anchor's literal dest is /old whose
		// stamped status is 301 (`Moved Permanently`), so it does NOT
		// satisfy the broken filter — the result is empty.
		expect(result.items).toHaveLength(0);
	});
});

/**
 * Separate describe with a dedicated fixture: an anchor that points at an
 * alias URL (merged via `content_items.alias_of_id`) whose representative
 * is broken (404). Pins the alias-resolved broken/external judgment —
 * mirrors "listLinks — redirect resolution" above but for alias merges.
 */
describe('listLinks: content_items.alias_of_id handling', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_list_links_alias__');
	const archiveFilePath = path.resolve(dir, 'list-links-alias-test.nitpicker');

	const META = {
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

		// Source page with an anchor to /broken/index.html (the alias URL).
		await archive.setPage({
			url: parseUrl('https://example.com/source')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Source' },
			anchorList: [
				{
					href: parseUrl('https://example.com/broken/index.html')!,
					isExternal: false,
					title: null,
					textContent: 'Broken via alias',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// The alias's representative: 404 (broken).
		await archive.setPage({
			url: parseUrl('https://example.com/broken')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// The alias member itself: also present as its own content_items row.
		await archive.setPage({
			url: parseUrl('https://example.com/broken/index.html')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		const knex = archive.getKnex();
		const target = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/broken')
			.first();
		const member = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/broken/index.html')
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

	it('resolves an anchor targeting the alias URL to its representative for broken judgment', async () => {
		const result = await listLinks(archive, { type: 'broken' });
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			sourceUrl: 'https://example.com/source',
			destUrl: 'https://example.com/broken',
			status: 404,
		});
	});

	it('throws an actionable error when content_items.alias_of_id does not exist', async () => {
		const knex = archive.getKnex();
		await knex.schema.alterTable('content_items', (t) => {
			t.dropColumn('alias_of_id');
		});

		await expect(listLinks(archive, { type: 'broken' })).rejects.toThrow(/viewer-build/);

		// Restore the column so afterAll's close()/other tests are unaffected.
		await knex.schema.alterTable('content_items', (t) => {
			t.integer('alias_of_id');
		});
	});
});

/**
 * Pins the code-review-confirmed gap: a redirect destination row can itself
 * be a non-representative alias member of a *different* group
 * (`backfillAliasOfId` only excludes redirect *sources* from alias
 * candidacy, not redirect *destinations*), so resolution must follow one
 * more `alias_of_id` hop after `redirect_dest_id`, not stop at the first hop.
 */
describe('listLinks: a redirect landing on a non-representative alias member', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_list_links_redirect_then_alias__');
	const archiveFilePath = path.resolve(
		dir,
		'list-links-redirect-then-alias-test.nitpicker',
	);

	const META = {
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

		// /source anchors to /old, which redirects to /new/index.html, which
		// is itself merged as an alias member of /new (the true final page).
		await archive.setPage({
			url: parseUrl('https://example.com/source')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Source' },
			anchorList: [
				{
					href: parseUrl('https://example.com/old')!,
					isExternal: false,
					title: null,
					textContent: 'Old link',
				},
			],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/new/index.html')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/new')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setRedirect({
			url: parseUrl('https://example.com/old')!,
			redirectPaths: ['https://example.com/new/index.html'],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		const knex = archive.getKnex();
		const rep = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/new')
			.first();
		const member = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/new/index.html')
			.first();
		await knex('content_items').where('id', member.id).update({ alias_of_id: rep.id });
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('resolves the anchor all the way to the true representative, not the redirect-destination-as-alias-member', async () => {
		const result = await listLinks(archive, { type: 'broken' });
		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			sourceUrl: 'https://example.com/source',
			destUrl: 'https://example.com/new',
			status: 404,
		});
	});
});
