import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listExternalLinks } from './list-external-links.js';
import { listInboundLinks } from './list-inbound-links.js';
import { makeBeholderMeta } from './test-helpers/make-beholder-meta.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
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
};

describe('listInboundLinks', () => {
	let archive: InstanceType<typeof Archive>;
	const workingDir = path.resolve(__dirname, '__test_fixtures_list_inbound_links__');
	const archiveFilePath = path.resolve(workingDir, 'list-inbound-links-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

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
			html: '<html><head><title>About</title></head></html>',
			meta: makeBeholderMeta({ title: 'About' }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/referrer-a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: makeBeholderMeta({ title: 'Referrer A' }),
			anchorList: [
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: 'About A',
				},
			],
			imageList: [],
			isSkipped: false,
		});
		// Two separate <a> tags to the same target (e.g. a nav link and a
		// footer link) — must collapse to one inbound-link entry with count: 2,
		// not two entries.
		await archive.setPage({
			url: parseUrl('https://example.com/referrer-b')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: makeBeholderMeta({ title: 'Referrer B' }),
			anchorList: [
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: 'About B1',
				},
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: 'About B2',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// A referrer whose anchor carries no text (e.g. an image link with no
		// alt) — must resolve to textContent: null, not an empty string or a
		// thrown error.
		await archive.setPage({
			url: parseUrl('https://example.com/referrer-c')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: makeBeholderMeta({ title: 'Referrer C' }),
			anchorList: [
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: null,
				},
			],
			imageList: [],
			isSkipped: false,
		});

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('lists referrers with anchor text and per-referrer count, one row per referrer', async () => {
		const result = await listInboundLinks(archive, { url: 'https://example.com/about' });
		expect(result).not.toBeNull();
		expect(result!.total).toBe(3);
		const byUrl = new Map(result!.items.map((item) => [item.url, item]));
		expect(byUrl.get('https://example.com/referrer-a')).toEqual({
			url: 'https://example.com/referrer-a',
			textContent: 'About A',
			count: 1,
		});
		// First-wins: the first <a> tag's text ("About B1") is kept even
		// though a second anchor to the same target follows it.
		expect(byUrl.get('https://example.com/referrer-b')).toEqual({
			url: 'https://example.com/referrer-b',
			textContent: 'About B1',
			count: 2,
		});
		// No anchor text — resolves to null, not '' or a thrown error.
		expect(byUrl.get('https://example.com/referrer-c')).toEqual({
			url: 'https://example.com/referrer-c',
			textContent: null,
			count: 1,
		});
	});

	it('echoes back the requested url verbatim', async () => {
		const result = await listInboundLinks(archive, { url: 'https://example.com/about' });
		expect(result!.url).toBe('https://example.com/about');
	});

	it('returns null for a URL that does not match any page', async () => {
		const result = await listInboundLinks(archive, {
			url: 'https://example.com/nonexistent',
		});
		expect(result).toBeNull();
	});

	it('limit: 0 returns only the total, skipping the row window', async () => {
		const result = await listInboundLinks(archive, {
			url: 'https://example.com/about',
			limit: 0,
		});
		expect(result!.total).toBe(3);
		expect(result!.items).toHaveLength(0);
	});

	it('limit: 0 never queries viewer_anchor_facts for rows, viewer_url_refs, or text_refs', async () => {
		const knex = archive.getKnex();
		const queries: string[] = [];
		const listener = (query: { sql: string }) => queries.push(query.sql);
		knex.on('query', listener);
		try {
			await listInboundLinks(archive, { url: 'https://example.com/about', limit: 0 });
		} finally {
			knex.removeListener('query', listener);
		}
		// The count query (`select count(*) ... from "viewer_anchor_facts"`)
		// is expected and excluded here; anything selecting individual rows
		// from viewer_anchor_facts, or resolving viewer_url_refs/text_refs
		// (only needed once a row window exists), would mean the `limit: 0`
		// short-circuit stopped short-circuiting.
		const unexpectedQueries = queries.filter(
			(sql) =>
				/from "viewer_url_refs"/i.test(sql) ||
				/from "text_refs"/i.test(sql) ||
				(/from "viewer_anchor_facts"/i.test(sql) && !/count/i.test(sql)),
		);
		expect(unexpectedQueries).toEqual([]);
	});
});

describe('listInboundLinks: redirect resolution (http/https 合算, #71 の被リンク版)', () => {
	let archive: InstanceType<typeof Archive>;
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_list_inbound_links_redirect__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'list-inbound-links-redirect.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

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
			meta: makeBeholderMeta({ title: 'Page' }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// 2) http source that 301s to the https destination.
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
			meta: makeBeholderMeta(),
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
			meta: makeBeholderMeta(),
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
			meta: makeBeholderMeta(),
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

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('aggregates the direct https link and the link via the http redirect source together', async () => {
		const result = await listInboundLinks(archive, { url: 'https://example.com/page' });
		const inboundUrls = result!.items.map((item) => item.url).toSorted();
		expect(inboundUrls).toEqual([
			'https://example.com/linker-http',
			'https://example.com/linker-https',
		]);
	});

	it('resolves the same inbound links when queried by the redirect-source URL', async () => {
		const result = await listInboundLinks(archive, { url: 'http://example.com/page' });
		const inboundUrls = result!.items.map((item) => item.url).toSorted();
		expect(inboundUrls).toEqual([
			'https://example.com/linker-http',
			'https://example.com/linker-https',
		]);
	});
});

describe('listInboundLinks: content_items.alias_of_id handling', () => {
	let archive: InstanceType<typeof Archive>;
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_list_inbound_links_alias__',
	);
	const archiveFilePath = path.resolve(workingDir, 'list-inbound-links-alias.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

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

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('resolves inbound links targeting the alias URL to the canonical page', async () => {
		const result = await listInboundLinks(archive, { url: 'https://example.com' });
		const inboundUrls = result!.items.map((item) => item.url);
		expect(inboundUrls).toEqual(['https://example.com/linker']);
	});

	it('resolves the same inbound links when queried by the alias URL itself', async () => {
		const result = await listInboundLinks(archive, {
			url: 'https://example.com/index.html',
		});
		const inboundUrls = result!.items.map((item) => item.url);
		expect(inboundUrls).toEqual(['https://example.com/linker']);
	});
});

describe('listInboundLinks: cursor pagination', () => {
	let archive: InstanceType<typeof Archive>;
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_list_inbound_links_cursor__',
	);
	const archiveFilePath = path.resolve(workingDir, 'list-inbound-links-cursor.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/target')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: makeBeholderMeta({ title: 'Target' }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		for (const name of ['referrer-a', 'referrer-b']) {
			await archive.setPage({
				url: parseUrl(`https://example.com/${name}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: makeBeholderMeta({ title: name }),
				anchorList: [
					{
						href: parseUrl('https://example.com/target')!,
						isExternal: false,
						title: null,
						textContent: `Link from ${name}`,
					},
				],
				imageList: [],
				isSkipped: false,
			});
		}

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('paginates forward via nextCursor with no duplicates or gaps', async () => {
		const page1 = await listInboundLinks(archive, {
			url: 'https://example.com/target',
			limit: 1,
		});
		expect(page1!.items).toHaveLength(1);
		expect(page1!.total).toBe(2);
		expect(page1!.nextCursor).not.toBeNull();
		expect(page1!.prevCursor).toBeNull();

		const page2 = await listInboundLinks(archive, {
			url: 'https://example.com/target',
			limit: 1,
			cursor: page1!.nextCursor!,
		});
		expect(page2!.items).toHaveLength(1);
		expect(page2!.total).toBe(2);
		expect(page2!.nextCursor).toBeNull();
		expect(page2!.prevCursor).not.toBeNull();

		expect([...page1!.items, ...page2!.items].map((item) => item.url).toSorted()).toEqual(
			['https://example.com/referrer-a', 'https://example.com/referrer-b'],
		);
	});

	it('walks backward from a forward cursor via direction: "prev" and restores the same page', async () => {
		const page1 = await listInboundLinks(archive, {
			url: 'https://example.com/target',
			limit: 1,
		});
		const page2 = await listInboundLinks(archive, {
			url: 'https://example.com/target',
			limit: 1,
			cursor: page1!.nextCursor!,
		});
		const back = await listInboundLinks(archive, {
			url: 'https://example.com/target',
			limit: 1,
			cursor: page2!.prevCursor!,
			direction: 'prev',
		});
		expect(back!.items).toEqual(page1!.items);
	});

	it('supports a direct offset read for MPA page-number jumps', async () => {
		const result = await listInboundLinks(archive, {
			url: 'https://example.com/target',
			limit: 1,
			offset: 1,
		});
		expect(result!.items).toHaveLength(1);
	});

	it('throws on a cursor minted for a different destPageId', async () => {
		const page1 = await listInboundLinks(archive, {
			url: 'https://example.com/target',
			limit: 1,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/other-target')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: makeBeholderMeta({ title: 'Other target' }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await buildViewerReadModel(archive);
		await expect(
			listInboundLinks(archive, {
				url: 'https://example.com/other-target',
				limit: 1,
				cursor: page1!.nextCursor!,
			}),
		).rejects.toThrow(/does not match/);
	});
});

describe('listInboundLinks: viewer read model guard', () => {
	let archive: InstanceType<typeof Archive>;
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_list_inbound_links_no_read_model__',
	);
	const archiveFilePath = path.resolve(
		workingDir,
		'list-inbound-links-no-read-model.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

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
			meta: makeBeholderMeta({ title: 'About' }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		// No `buildViewerReadModel` call — the read model is never built.
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('throws an actionable error when the viewer read model is missing', async () => {
		await expect(
			listInboundLinks(archive, { url: 'https://example.com/about' }),
		).rejects.toThrow(/viewer-build/);
	});

	it('throws an actionable error when content_items.alias_of_id does not exist', async () => {
		const knex = archive.getKnex();
		await knex.schema.alterTable('content_items', (t) => {
			t.dropColumn('alias_of_id');
		});

		await expect(
			listInboundLinks(archive, { url: 'https://example.com/about' }),
		).rejects.toThrow(/viewer-build/);

		// Restore the column so afterAll's close()/other tests are unaffected.
		await knex.schema.alterTable('content_items', (t) => {
			t.integer('alias_of_id');
		});
	});
});

describe('listInboundLinks: counting grain matches listExternalLinks.referrerCount', () => {
	// Fixes ARCHITECTURE.md's invariant that both functions count referrers
	// at the same grain (one row per referrer page, not per anchor) — a
	// regression here would silently desync the External Links view's
	// referrer count from Page Detail's / the inbound-links view's total.
	let archive: InstanceType<typeof Archive>;
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_list_inbound_links_grain__',
	);
	const archiveFilePath = path.resolve(workingDir, 'list-inbound-links-grain.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await archive.setPage({
			url: parseUrl('https://example.com/referrer-a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: makeBeholderMeta({ title: 'Referrer A' }),
			anchorList: [
				{
					href: parseUrl('https://external.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Ad banner',
				},
				{
					href: parseUrl('https://external.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Ad footer',
				},
			],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/referrer-b')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: makeBeholderMeta({ title: 'Referrer B' }),
			anchorList: [
				{
					href: parseUrl('https://external.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'Ad sidebar',
				},
			],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://external.example.com/')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: makeBeholderMeta(),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('reports the same referrer count as listExternalLinks for the same destination', async () => {
		const inbound = await listInboundLinks(archive, {
			url: 'https://external.example.com',
		});
		const external = await listExternalLinks(archive, {});
		const externalEntry = external.items.find(
			(item) => item.destUrl === 'https://external.example.com',
		);
		expect(externalEntry).toBeDefined();
		expect(inbound!.total).toBe(externalEntry!.referrerCount);
		expect(inbound!.total).toBe(2);
	});
});
