import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { findMismatches } from './find-mismatches.js';
import { makeBeholderMeta } from './test-helpers/make-beholder-meta.js';

vi.mock('./url-sort-temp-table.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./url-sort-temp-table.js')>();
	return { ...actual, ensureUrlSortTempTable: vi.fn(actual.ensureUrlSortTempTable) };
});
const { ensureUrlSortTempTable } = await import('./url-sort-temp-table.js');

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_find_mismatches__');

describe('findMismatches', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'find-mismatches-test.nitpicker');

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

		// Page with canonical mismatch
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
			meta: makeBeholderMeta({
				title: 'Home',
				description: 'Home description',
				link: { canonical: 'https://example.com/home' },
				og: {
					title: 'Different OG Title',
					description: 'Different OG Description',
				},
			}),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Page with no mismatches
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
			meta: makeBeholderMeta({
				title: 'About',
				link: { canonical: 'https://example.com/about' },
				og: { title: 'About' },
			}),
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

	it('canonical ミスマッチを検出する', async () => {
		const result = await findMismatches(archive, 'canonical');
		expect(result).toHaveLength(1);
		expect(result[0]!.url).toContain('example.com');
		expect(result[0]!.type).toBe('canonical');
		expect(result[0]!.expected).toBe('https://example.com/home');
	});

	it('og:title ミスマッチを検出する', async () => {
		const result = await findMismatches(archive, 'og:title');
		expect(result).toHaveLength(1);
		expect(result[0]!.url).toContain('example.com');
		expect(result[0]!.actual).toBe('Different OG Title');
		expect(result[0]!.expected).toBe('Home');
	});

	it('og:description ミスマッチを検出する', async () => {
		const result = await findMismatches(archive, 'og:description');
		expect(result).toHaveLength(1);
		expect(result[0]!.url).toContain('example.com');
		expect(result[0]!.actual).toBe('Different OG Description');
		expect(result[0]!.expected).toBe('Home description');
	});

	it('limit と offset が機能する', async () => {
		const result = await findMismatches(archive, 'canonical', 0);
		expect(result).toHaveLength(0);
	});

	it('canonical type で明示的な sortBy を指定してもクラッシュしない', async () => {
		// Regression test: an explicit `sortBy` routes the `canonical` type's
		// `url`/`actual`/`expected` columns through the natural-URL-sort TEMP
		// table (`viewer_url_sort_keys`). If `findMismatches` skips
		// `ensureUrlSortTempTable`, any explicit `sortBy` on this type
		// crashes with `no such table: viewer_url_sort_keys`.
		const byActual = await findMismatches(archive, 'canonical', {
			sortBy: 'actual',
			sortOrder: 'desc',
		});
		expect(byActual.items).toHaveLength(1);

		const byExpected = await findMismatches(archive, 'canonical', { sortBy: 'expected' });
		expect(byExpected.items).toHaveLength(1);

		const byUrl = await findMismatches(archive, 'canonical', { sortBy: 'url' });
		expect(byUrl.items).toHaveLength(1);
	});

	it('does not build the URL-sort temp table for og:title/og:description sorted by actual/expected', async () => {
		// Regression test: gating `ensureUrlSortTempTable` on `useUrlSort`
		// alone (any explicit `sortBy`) would pay the full
		// external-merge-sort setup cost even for `actual`/`expected` sorts on
		// `og:title`/`og:description` — columns that are never URL-typed.
		vi.mocked(ensureUrlSortTempTable).mockClear();

		const byActual = await findMismatches(archive, 'og:title', { sortBy: 'actual' });
		expect(byActual.items).toHaveLength(1);
		const byExpected = await findMismatches(archive, 'og:description', {
			sortBy: 'expected',
		});
		expect(byExpected.items).toHaveLength(1);

		expect(ensureUrlSortTempTable).not.toHaveBeenCalled();
	});

	it('does build the URL-sort temp table for og:title/og:description sorted by url, and for any explicit sortBy on canonical', async () => {
		vi.mocked(ensureUrlSortTempTable).mockClear();

		await findMismatches(archive, 'og:title', { sortBy: 'url' });
		expect(ensureUrlSortTempTable).toHaveBeenCalledTimes(1);

		await findMismatches(archive, 'canonical', { sortBy: 'actual' });
		expect(ensureUrlSortTempTable).toHaveBeenCalledTimes(2);
	});
});

describe('findMismatches: content_items.alias_of_id handling', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_find_mismatches_alias__');
	const archiveFilePath = path.resolve(dir, 'find-mismatches-alias-test.nitpicker');

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

		// The alias member itself has a canonical mismatch (points elsewhere),
		// but it must not surface once merged away via alias_of_id.
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
			html: '<html></html>',
			meta: makeBeholderMeta({
				title: 'Home',
				link: { canonical: 'https://example.com/somewhere-else' },
			}),
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

	it('excludes an alias member from canonical mismatch results', async () => {
		const result = await findMismatches(archive, 'canonical');
		expect(result).toEqual([]);
	});

	it('throws an actionable error when content_items.alias_of_id does not exist', async () => {
		const knex = archive.getKnex();
		await knex.schema.alterTable('content_items', (t) => {
			t.dropColumn('alias_of_id');
		});

		await expect(findMismatches(archive, 'canonical')).rejects.toThrow(/viewer-build/);

		// Restore the column so afterAll's close()/other tests are unaffected.
		await knex.schema.alterTable('content_items', (t) => {
			t.integer('alias_of_id');
		});
	});
});
