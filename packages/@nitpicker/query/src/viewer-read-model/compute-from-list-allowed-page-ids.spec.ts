import type { Knex } from 'knex';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeFromListAllowedPageIds } from './compute-from-list-allowed-page-ids.js';

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.13.0',
	recursive: false,
	interval: 0,
	image: true,
	fetchExternal: false,
	parallels: 1,
	roots: [] as string[],
	excludes: [],
	excludeKeywords: [],
	excludeUrls: [],
	maxExcludedDepth: 0,
	retry: 3,
	fromList: true,
	disableQueries: false,
	userAgent: 'test',
	ignoreRobots: false,
};

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

describe('computeFromListAllowedPageIds', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_compute_from_list_allowed_page_ids__',
	);
	const archiveFilePath = path.resolve(workingDir, 'from-list-allowed-test.nitpicker');
	let archive: InstanceType<typeof Archive>;
	let knex: Knex;

	/**
	 *
	 * @param url
	 */
	async function idOf(url: string): Promise<number> {
		const row = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.where('ur.url', url)
			.select('ci.id as id')
			.first();
		return row.id;
	}

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);
		knex = archive.getKnex();

		// A: a plain root, no redirect/alias involved.
		await archive.setPage({
			url: parseUrl('https://example.com/a')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'A' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// B -> C: a redirecting root.
		await archive.setPage({
			url: parseUrl('https://example.com/c')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'C' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setRedirect({
			url: parseUrl('https://example.com/b')!,
			redirectPaths: ['https://example.com/c'],
			isExternal: false,
			isTarget: true,
			status: 301,
			statusText: 'Moved Permanently',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// D -> E, where E is itself a non-representative alias member of F —
		// the one-further-hop case `backfillAliasOfId` can leave (a redirect
		// destination that is itself an alias-group member).
		await archive.setPage({
			url: parseUrl('https://example.com/f')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'F' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/e')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'E' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setRedirect({
			url: parseUrl('https://example.com/d')!,
			redirectPaths: ['https://example.com/e'],
			isExternal: false,
			isTarget: true,
			status: 301,
			statusText: 'Moved Permanently',
			contentType: 'text/html',
			contentLength: 0,
			responseHeaders: {},
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await knex('content_items')
			.where('id', await idOf('https://example.com/e'))
			.update({ alias_of_id: await idOf('https://example.com/f') });

		// G: itself an alias-group member of H, no redirect involved.
		await archive.setPage({
			url: parseUrl('https://example.com/h')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'H' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/g')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'G' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await knex('content_items')
			.where('id', await idOf('https://example.com/g'))
			.update({ alias_of_id: await idOf('https://example.com/h') });

		// A query-order/auth normalization case.
		await archive.setPage({
			url: parseUrl('https://example.com/query?a=2&b=1')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Query' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('includes a root with no redirect/alias as itself', async () => {
		const allowed = await computeFromListAllowedPageIds({
			trx: knex,
			roots: ['https://example.com/a'],
			disableQueries: false,
		});
		expect(allowed.has(await idOf('https://example.com/a'))).toBe(true);
		expect(allowed.size).toBe(1);
	});

	it('resolves a redirecting root to its destination, admitting both the root and the destination', async () => {
		const allowed = await computeFromListAllowedPageIds({
			trx: knex,
			roots: ['https://example.com/b'],
			disableQueries: false,
		});
		expect(allowed.has(await idOf('https://example.com/b'))).toBe(true);
		expect(allowed.has(await idOf('https://example.com/c'))).toBe(true);
		expect(allowed.size).toBe(2);
	});

	it('resolves one further hop when the redirect destination is itself a non-representative alias-group member', async () => {
		const allowed = await computeFromListAllowedPageIds({
			trx: knex,
			roots: ['https://example.com/d'],
			disableQueries: false,
		});
		expect(allowed.has(await idOf('https://example.com/d'))).toBe(true);
		expect(allowed.has(await idOf('https://example.com/f'))).toBe(true);
		expect(allowed.has(await idOf('https://example.com/e'))).toBe(false);
	});

	it('resolves a root that is itself an alias-group member (no redirect)', async () => {
		const allowed = await computeFromListAllowedPageIds({
			trx: knex,
			roots: ['https://example.com/g'],
			disableQueries: false,
		});
		expect(allowed.has(await idOf('https://example.com/g'))).toBe(true);
		expect(allowed.has(await idOf('https://example.com/h'))).toBe(true);
	});

	it('normalizes an auth-bearing, unordered-query root to match the stored (auth-stripped, query-sorted) URL', async () => {
		const allowed = await computeFromListAllowedPageIds({
			trx: knex,
			roots: ['https://user:pass@example.com/query?b=1&a=2'],
			disableQueries: false,
		});
		expect(allowed.has(await idOf('https://example.com/query?a=2&b=1'))).toBe(true);
	});

	it('returns an empty set when every root fails to normalize to an HTTP(S) URL', async () => {
		const allowed = await computeFromListAllowedPageIds({
			trx: knex,
			roots: ['not a url at all', 'mailto:someone@example.com'],
			disableQueries: false,
		});
		expect(allowed.size).toBe(0);
	});

	it('resolves correctly across a chunk boundary with more than SQLITE_IN_CHUNK roots', async () => {
		const noise = Array.from(
			{ length: 501 },
			(_, i) => `https://example.com/nonexistent-${i}`,
		);
		const allowed = await computeFromListAllowedPageIds({
			trx: knex,
			roots: [...noise, 'https://example.com/a'],
			disableQueries: false,
		});
		expect(allowed.has(await idOf('https://example.com/a'))).toBe(true);
		expect(allowed.size).toBe(1);
	});
});
