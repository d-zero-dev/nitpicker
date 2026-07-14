import type { CrawlerError } from '@nitpicker/crawler';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getErrorKinds } from '../get-error-kinds.js';
import { getSummary } from '../get-summary.js';
import { listPages } from '../list-pages.js';
import { listViewerBrokenLinks } from '../list-viewer-broken-links.js';
import { listViewerExternalLinks } from '../list-viewer-external-links.js';

import { buildViewerReadModel } from './build-viewer-read-model.js';
import { hasViewerReadModel } from './has-viewer-read-model.js';

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

describe('buildViewerReadModel', () => {
	describe('read-only guard', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_readonly__',
		);
		const archiveFilePath = path.resolve(workingDir, 'readonly-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);
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
				meta: { ...META, title: 'Home' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
			await populateMigrationTables(archive);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('throws on a read-only accessor and leaves the archive untouched', async () => {
			const readOnlyAccessor = await Archive.connect(archive.tmpDir);
			try {
				await expect(buildViewerReadModel(readOnlyAccessor)).rejects.toThrow(
					/read-only/i,
				);
				// The throw happens before any DB access, so the archive must be
				// exactly as it was: no read model, and the write-model row count
				// unaffected.
				expect(await hasViewerReadModel(readOnlyAccessor)).toBe(false);
				expect(await hasViewerReadModel(archive)).toBe(false);
				const pageCount = await archive.getKnex()('pages').count<{ count: string }[]>({
					count: '*',
				});
				expect(Number(pageCount[0]?.count)).toBe(1);
			} finally {
				await readOnlyAccessor.close();
			}
		});
	});

	describe('population + idempotency', () => {
		const workingDir = path.resolve(__dirname, '__test_fixtures_build_read_model__');
		const archiveFilePath = path.resolve(workingDir, 'build-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

			// Listable, full metadata.
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
					...META,
					title: 'Home',
					description: 'Home description',
					og: { title: 'OG Home' },
				},
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});

			// Listable, empty-string title/description (must count as "missing",
			// same idiom as list-pages.ts's missingTitle/missingDescription).
			await archive.setPage({
				url: parseUrl('https://example.com/empty-meta')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...META, title: '', description: '', robots: { noindex: true } },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});

			// Listable, external.
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
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});

			// Listable, errored/unreached (null contentType + null status).
			await archive.setPage({
				url: parseUrl('https://example.com/errored')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: null,
				statusText: null,
				contentType: null,
				contentLength: 0,
				responseHeaders: {},
				html: '',
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});

			// Redirect destination (listable) + redirect source (must be
			// EXCLUDED from viewer_pages: it has redirectDestId set).
			await archive.setPage({
				url: parseUrl('https://example.com/new-canonical')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...META, title: 'Canonical' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
			await archive.setRedirect({
				url: parseUrl('https://example.com/old')!,
				redirectPaths: ['https://example.com/new-canonical'],
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
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('populates viewer_pages with exactly the 5 listable fixture pages (redirect source excluded)', async () => {
			await buildViewerReadModel(archive);
			const knex = archive.getKnex();

			// Hardcoded literal, not re-derived from another query: home,
			// empty-meta, external, errored, and the redirect destination.
			// The redirect *source* (/old) has redirectDestId set and must
			// not count.
			const viewerPagesCount = await knex('viewer_pages').count<{ count: string }[]>({
				count: '*',
			});
			expect(Number(viewerPagesCount[0]?.count)).toBe(5);

			const oldRow = await knex('viewer_pages')
				.where('url', 'https://example.com/old')
				.first();
			expect(oldRow).toBeUndefined();
		});

		it("matches listPages()'s listable-page total (independent cross-check)", async () => {
			const knex = archive.getKnex();
			const { total } = await listPages(archive, {});
			const viewerPagesCount = await knex('viewer_pages').count<{ count: string }[]>({
				count: '*',
			});
			// Every fixture page here is 'text/html' or null-contentType, so
			// listPages()'s default (html + null) view covers the exact same
			// set as viewer_pages' unfiltered listable projection. This is a
			// cross-check against a separately-implemented, already-tested
			// query function — not a re-derivation of the same arithmetic
			// buildViewerReadModel itself does.
			expect(Number(viewerPagesCount[0]?.count)).toBe(total);
		});

		it('derives has_title/has_description/has_og_title using the same "non-null and non-empty" idiom as list-pages.ts', async () => {
			const knex = archive.getKnex();
			// parseUrl normalises a bare-root URL by stripping the trailing
			// slash (same convention list-links.spec.ts's own assertions
			// rely on), so the stored/queried form here is without one.
			const home = await knex('viewer_pages').where('url', 'https://example.com').first();
			expect(home).toMatchObject({ has_title: 1, has_description: 1, has_og_title: 1 });

			const emptyMeta = await knex('viewer_pages')
				.where('url', 'https://example.com/empty-meta')
				.first();
			expect(emptyMeta).toMatchObject({
				has_title: 0,
				has_description: 0,
				has_og_title: 0,
				robots_noindex: 1,
			});
		});

		it('classifies a null contentType page as content_category "unknown"', async () => {
			const knex = archive.getKnex();
			const errored = await knex('viewer_pages')
				.where('url', 'https://example.com/errored')
				.first();
			expect(errored).toMatchObject({ content_category: 'unknown', status: null });
		});

		it('substitutes the null-status sentinel into status_sort_key/status_desc_key for a null-status page', async () => {
			const knex = archive.getKnex();
			const errored = await knex('viewer_pages')
				.where('url', 'https://example.com/errored')
				.first();
			// -32768: NULL_STATUS_SENTINEL, smaller than any real HTTP status so
			// unknown-status rows sort first in ascending order (see that
			// constant's docs in build-viewer-read-model.ts).
			expect(errored).toMatchObject({
				status_sort_key: -32_768,
				status_desc_key: 32_768,
			});
		});

		it('derives status_sort_key/status_desc_key as status and its negation for a known-status page', async () => {
			const knex = archive.getKnex();
			const home = await knex('viewer_pages').where('url', 'https://example.com').first();
			expect(home).toMatchObject({ status_sort_key: 200, status_desc_key: -200 });
		});

		it('defaults source to "crawled" and stores "" (not null) for title_sort_key on an empty title', async () => {
			const knex = archive.getKnex();
			const home = await knex('viewer_pages').where('url', 'https://example.com').first();
			expect(home).toMatchObject({ source: 'crawled', title_sort_key: 'Home' });

			const emptyMeta = await knex('viewer_pages')
				.where('url', 'https://example.com/empty-meta')
				.first();
			// The write model itself normalises an empty-string title to `null`
			// (see `has_title: 0` assertion above) — title_sort_key must still
			// come out `''`, not `null`.
			expect(emptyMeta).toMatchObject({ title: null, title_sort_key: '' });
		});

		it('flows is_external through for external pages', async () => {
			const knex = archive.getKnex();
			const external = await knex('viewer_pages')
				.where('url', 'https://example.net')
				.first();
			expect(external).toMatchObject({ is_external: 1 });
		});

		it('seeds one matching viewer_query_profiles row and a total viewer_count_buckets row, both equal to the hardcoded 5-page total', async () => {
			const knex = archive.getKnex();

			const profiles = await knex('viewer_query_profiles').select('*');
			expect(profiles).toHaveLength(1);
			expect(profiles[0]).toMatchObject({ scope: 'pages', total: 5 });

			const totalBucket = await knex('viewer_count_buckets')
				.where({ scope: 'pages', key: 'total', value: 'all' })
				.first();
			expect(totalBucket).toMatchObject({ count: 5 });

			const meta = await knex('viewer_read_model_meta').where('id', 1).first();
			expect(meta).toMatchObject({ source_row_count: 5 });
		});

		it('populates viewer_count_buckets with per-category and default-scoped facet rows', async () => {
			const knex = archive.getKnex();
			const buckets: { key: string; value: string; count: number }[] = await knex(
				'viewer_count_buckets',
			)
				.where('scope', 'pages')
				.where('key', 'like', 'facet:%')
				.select('key', 'value', 'count');
			const byKeyValue = new Map(buckets.map((b) => [`${b.key}=${b.value}`, b.count]));

			// html category: home / empty-meta / external / new-canonical — all
			// status 200; is_external splits 3 internal / 1 external. None of
			// this fixture's pages set a lang, so no lang facet row exists at all.
			expect(byKeyValue.get('facet:status:content_category=html=200')).toBe(4);
			expect(byKeyValue.get('facet:is_external:content_category=html=0')).toBe(3);
			expect(byKeyValue.get('facet:is_external:content_category=html=1')).toBe(1);
			expect(buckets.some((b) => b.key.startsWith('facet:lang:'))).toBe(false);

			// unknown category: only the null-contentType errored page (null
			// status is excluded from the status facet entirely).
			expect(byKeyValue.get('facet:is_external:content_category=unknown=0')).toBe(1);
			expect(byKeyValue.has('facet:status:content_category=unknown=200')).toBe(false);

			// default (html ∪ unknown) mirrors the combined html+unknown population.
			expect(byKeyValue.get('facet:status:content_category=default=200')).toBe(4);
			expect(byKeyValue.get('facet:is_external:content_category=default=0')).toBe(4);
			expect(byKeyValue.get('facet:is_external:content_category=default=1')).toBe(1);
		});

		it('viewer_page_anchors stays empty (page-jump population is out of scope for #108)', async () => {
			const knex = archive.getKnex();
			const rows = await knex('viewer_page_anchors').select('*');
			expect(rows).toHaveLength(0);
		});

		it('rebuilds idempotently — calling twice leaves exactly one meta row and the same page count', async () => {
			const knex = archive.getKnex();
			const before = await knex('viewer_pages').count<{ count: string }[]>({
				count: '*',
			});

			await buildViewerReadModel(archive);

			const after = await knex('viewer_pages').count<{ count: string }[]>({ count: '*' });
			expect(after[0]?.count).toBe(before[0]?.count);

			const metaRows = await knex('viewer_read_model_meta').select('*');
			expect(metaRows).toHaveLength(1);
		});
	});

	describe('isSkipped exclusion', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_skipped__',
		);
		const archiveFilePath = path.resolve(workingDir, 'skipped-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

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
				meta: { ...META, title: 'Home' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});

			// A discovery-only placeholder row matched by an --exclude
			// pattern: status/contentType are always null and it must never
			// surface in viewer_pages (same predicate excludeSkippedPages
			// guards get-summary.ts against — see that helper's docs for
			// the production incident this mirrors).
			await archive.setPage({
				url: parseUrl('https://example.com/excluded')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: false,
				status: null,
				statusText: null,
				contentType: null,
				contentLength: 0,
				responseHeaders: {},
				html: '',
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: true,
			});
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('excludes isSkipped rows from viewer_pages', async () => {
			await buildViewerReadModel(archive);
			const knex = archive.getKnex();

			const rows = await knex('viewer_pages').select('url');
			expect(rows.map((r) => r.url)).toEqual(['https://example.com']);

			const excluded = await knex('viewer_pages')
				.where('url', 'https://example.com/excluded')
				.first();
			expect(excluded).toBeUndefined();
		});
	});

	describe('legacy rows with null tag_count/jsonld_count/robots_noindex/isExternal and an unparseable URL', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_legacy__',
		);
		const archiveFilePath = path.resolve(workingDir, 'legacy-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

			// Bypass setPage() entirely: none of `setPage`'s callers ever
			// leave tag_count/jsonld_count/robots_noindex/isExternal null
			// (compute-page-denormalized.ts always writes a `.length`, and
			// beholder always writes 0/1), and every URL setPage stores was
			// already validated by parseUrl. This raw insert simulates a
			// pre-migration/legacy row where those columns are genuinely
			// null and the URL predates strict validation, to exercise
			// buildViewerReadModel's defensive `?? 0` fallbacks and
			// derivePathSortKey's unparseable-URL catch branch — neither of
			// which any setPage()-based fixture can reach.
			await archive.getKnex()('pages').insert({
				url: 'not a valid url',
				scraped: 1,
				isTarget: 1,
				isExternal: null,
				robots_noindex: null,
				tag_count: null,
				jsonld_count: null,
			});
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('defaults null counters to 0, null flags to 0, and falls back to the raw URL for path_sort_key', async () => {
			await buildViewerReadModel(archive);
			const knex = archive.getKnex();

			const row = await knex('viewer_pages').where('url', 'not a valid url').first();
			expect(row).toMatchObject({
				is_external: 0,
				robots_noindex: 0,
				tag_count: 0,
				jsonld_count: 0,
				url_sort_key: 'not a valid url',
				path_sort_key: 'not a valid url',
				// Never-null keyset sort keys, substituted for the row's null
				// title/status (pages.source keeps its own NOT NULL DEFAULT
				// 'crawled', so no substitution is needed there).
				title_sort_key: '',
				status_sort_key: -32_768,
				status_desc_key: 32_768,
				source: 'crawled',
			});
		});
	});

	describe('onProgress', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_progress__',
		);
		const archiveFilePath = path.resolve(workingDir, 'progress-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);
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
				meta: { ...META, title: 'Home' },
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

		it('reports the final chunk with insertedRows equal to totalRows', async () => {
			const calls: { insertedRows: number; totalRows: number }[] = [];
			await buildViewerReadModel(archive, { onProgress: (p) => calls.push(p) });

			expect(calls.length).toBeGreaterThan(0);
			const last = calls.at(-1)!;
			expect(last.insertedRows).toBe(last.totalRows);
			expect(last.totalRows).toBe(1);
		});

		it('defaults to no progress reporting when onProgress is omitted', async () => {
			await expect(buildViewerReadModel(archive)).resolves.toBeUndefined();
		});
	});

	describe('onProgress: multiple chunks', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_progress_multi_chunk__',
		);
		const archiveFilePath = path.resolve(
			workingDir,
			'progress-multi-chunk-test.nitpicker',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

			// 750 rows spans two 500-row buildViewerReadModel chunks. A bulk
			// raw insert (not 750 sequential setPage() calls) both keeps the
			// test fast and matches the "legacy rows" fixture technique used
			// elsewhere in this file for rows that don't need full
			// setPage() semantics. An isolated archive (rather than reusing
			// another describe block's fixture) keeps the expected totals
			// round numbers, independent of sibling test execution order.
			//
			// Inserted in 2 sub-batches of ≤500 rows each — unrelated to
			// buildViewerReadModel's own 500-row INSERT_CHUNK_SIZE — because
			// SQLite's compound-SELECT term limit (default 500) rejects a
			// single `.insert()` call carrying all 750 rows at once.
			const knex = archive.getKnex();
			const rows = Array.from({ length: 750 }, (_, i) => ({
				url: `https://example.com/multi-chunk-${i}`,
				scraped: 1,
				isTarget: 1,
			}));
			await knex('pages').insert(rows.slice(0, 400));
			await knex('pages').insert(rows.slice(400));
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('reports insertedRows strictly monotonically across multiple chunks, in order', async () => {
			const calls: { insertedRows: number; totalRows: number }[] = [];
			await buildViewerReadModel(archive, { onProgress: (p) => calls.push(p) });

			expect(calls).toEqual([
				{ insertedRows: 500, totalRows: 750 },
				{ insertedRows: 750, totalRows: 750 },
			]);
		});
	});

	describe('empty archive', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_empty__',
		);
		const archiveFilePath = path.resolve(workingDir, 'empty-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('succeeds with zero pages, leaving viewer_pages empty and source_row_count = 0', async () => {
			await expect(buildViewerReadModel(archive)).resolves.toBeUndefined();
			const knex = archive.getKnex();
			const pageRows = await knex('viewer_pages').select('*');
			expect(pageRows).toHaveLength(0);
			const meta = await knex('viewer_read_model_meta').where('id', 1).first();
			expect(meta).toMatchObject({ source_row_count: 0 });
		});
	});

	describe('directory tree population', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_directory_tree__',
		);
		const archiveFilePath = path.resolve(workingDir, 'directory-tree-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

			// Root index page — attaches directly to the depth-0 root node.
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
				html: '',
				meta: META,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});

			// No trailing slash: attaches to directory /blog/2024/.
			await archive.setPage({
				url: parseUrl('https://example.com/blog/2024/post-1')!,
				redirectPaths: [],
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

			// Trailing slash: same directory node /blog/2024/ as an index page —
			// proves the boundary rule's second branch lands on the SAME node.
			await archive.setPage({
				url: parseUrl('https://example.com/blog/2024/')!,
				redirectPaths: [],
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

			// Bare directory index at /blog/ itself.
			await archive.setPage({
				url: parseUrl('https://example.com/blog/')!,
				redirectPaths: [],
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

			// Same host, out-of-scope subpath (isExternal: true) — must still
			// belong to example.com's tree, counted as external.
			await archive.setPage({
				url: parseUrl('https://example.com/legacy/old.html')!,
				redirectPaths: [],
				isExternal: true,
				isTarget: false,
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

			// A different same-host subtree (simulates a second multi-root crawl
			// origin sharing the same host, e.g. `crawl .../blog/ .../news/`) —
			// must become a sibling of /blog/, not a separate tree.
			await archive.setPage({
				url: parseUrl('https://example.com/news/announcement')!,
				redirectPaths: [],
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

			// 4 levels deep — proves the build itself does not cap depth (only
			// the /api/directory-tree endpoint caps its initial read at depth<=3).
			await archive.setPage({
				url: parseUrl('https://example.com/a/b/c/d/page')!,
				redirectPaths: [],
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

			// A host with ZERO internal pages — must be excluded from the
			// directory tree entirely (no nodes, no pages), even though it
			// remains a normal viewer_pages row.
			await archive.setPage({
				url: parseUrl('https://twitter.com/someaccount')!,
				redirectPaths: [],
				isExternal: true,
				isTarget: false,
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

			// An unparseable URL (raw insert, bypassing setPage, same technique
			// as the "legacy rows" describe block above) — must be skipped from
			// the directory tree (no host to group by) while remaining a normal
			// viewer_pages row.
			await archive.getKnex()('pages').insert({
				url: 'not a valid url',
				scraped: 1,
				isTarget: 1,
				isExternal: 0,
			});

			await buildViewerReadModel(archive);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		/**
		 * Fetches one `viewer_directory_nodes` row by its `path` within
		 * `example.com`'s tree, throwing if it's missing — assertion helper
		 * only, not exported.
		 * @param path - The node's full path (e.g. `/blog/2024/`).
		 * @returns The matching row.
		 */
		async function getNodeByPath(path: string) {
			const row = await archive
				.getKnex()('viewer_directory_nodes')
				.where({ root_key: 'example.com', path })
				.first();
			if (!row) {
				throw new Error(`no viewer_directory_nodes row for path ${path}`);
			}
			return row;
		}

		it('creates a root node (depth 0, path "/") with 4 direct child directories and 1 direct page', async () => {
			const root = await getNodeByPath('/');
			expect(root).toMatchObject({
				depth: 0,
				parent_node_id: null,
				direct_child_dir_count: 4,
				direct_page_count: 1,
				has_children: 1,
			});
		});

		it("sums the whole tree's internal/external pages onto the root's descendant counts", async () => {
			const root = await getNodeByPath('/');
			expect(root).toMatchObject({
				internal_descendant_page_count: 6,
				external_descendant_page_count: 1,
				descendant_page_count: 7,
			});
		});

		it('lands both the no-trailing-slash page and the trailing-slash index page on the same /blog/2024/ node', async () => {
			const node = await getNodeByPath('/blog/2024/');
			expect(node).toMatchObject({
				depth: 2,
				direct_child_dir_count: 0,
				direct_page_count: 2,
				internal_descendant_page_count: 2,
				external_descendant_page_count: 0,
				descendant_page_count: 2,
				// No child DIRECTORIES (only 2 direct pages) — nothing to expand
				// via listDirectoryChildren.
				has_children: 0,
			});
			const pages = await archive
				.getKnex()('viewer_directory_pages')
				.where('node_id', node.node_id)
				.select('page_url_sort_key');
			expect(pages.map((p) => p.page_url_sort_key).toSorted()).toEqual(
				[
					'https://example.com/blog/2024/',
					'https://example.com/blog/2024/post-1',
				].toSorted(),
			);
		});

		it('folds descendant counts up through /blog/ (own index page + the /blog/2024/ subtree)', async () => {
			const node = await getNodeByPath('/blog/');
			expect(node).toMatchObject({
				depth: 1,
				direct_child_dir_count: 1,
				direct_page_count: 1,
				internal_descendant_page_count: 3,
				external_descendant_page_count: 0,
				descendant_page_count: 3,
			});
		});

		it('counts a same-host, out-of-scope page as external on its own directory node', async () => {
			const node = await getNodeByPath('/legacy/');
			expect(node).toMatchObject({
				depth: 1,
				direct_page_count: 1,
				internal_descendant_page_count: 0,
				external_descendant_page_count: 1,
				descendant_page_count: 1,
			});
		});

		it('creates a sibling /news/ node under the same root rather than a separate tree', async () => {
			const news = await getNodeByPath('/news/');
			const root = await getNodeByPath('/');
			expect(news).toMatchObject({ depth: 1, parent_node_id: root.node_id });
		});

		it('creates every intermediate directory down to depth 4 with zero direct pages except the leaf', async () => {
			const a = await getNodeByPath('/a/');
			const ab = await getNodeByPath('/a/b/');
			const abc = await getNodeByPath('/a/b/c/');
			const abcd = await getNodeByPath('/a/b/c/d/');
			expect(a).toMatchObject({ depth: 1, direct_page_count: 0, has_children: 1 });
			expect(ab).toMatchObject({ depth: 2, direct_page_count: 0, has_children: 1 });
			expect(abc).toMatchObject({ depth: 3, direct_page_count: 0, has_children: 1 });
			// The leaf has a direct page but no child directories of its own.
			expect(abcd).toMatchObject({ depth: 4, direct_page_count: 1, has_children: 0 });
		});

		it('excludes a host with zero internal pages entirely (no nodes, no pages)', async () => {
			const knex = archive.getKnex();
			const nodes = await knex('viewer_directory_nodes')
				.where('root_key', 'twitter.com')
				.select('*');
			expect(nodes).toHaveLength(0);
		});

		it('skips a row with an unparseable URL from the directory tree without throwing', async () => {
			const knex = archive.getKnex();
			const pages = await knex('viewer_pages')
				.where('url', 'not a valid url')
				.select('*');
			expect(pages).toHaveLength(1);

			const total = await knex('viewer_directory_pages').count<{ count: string }[]>({
				count: '*',
			});
			// 7 attached pages: root, blog x1, blog/2024 x2, legacy, news, a/b/c/d —
			// the unparseable-URL row and the twitter.com row contribute none.
			expect(Number(total[0]?.count)).toBe(7);
		});

		it('rebuilds the directory tree idempotently — a second build leaves the same node/page counts and root counts', async () => {
			const knex = archive.getKnex();
			const nodesBefore = await knex('viewer_directory_nodes').count<{ count: string }[]>(
				{
					count: '*',
				},
			);
			const pagesBefore = await knex('viewer_directory_pages').count<{ count: string }[]>(
				{
					count: '*',
				},
			);
			const rootBefore = await getNodeByPath('/');

			await buildViewerReadModel(archive);

			const nodesAfter = await knex('viewer_directory_nodes').count<{ count: string }[]>({
				count: '*',
			});
			const pagesAfter = await knex('viewer_directory_pages').count<{ count: string }[]>({
				count: '*',
			});
			const rootAfter = await getNodeByPath('/');

			expect(nodesAfter[0]?.count).toBe(nodesBefore[0]?.count);
			expect(pagesAfter[0]?.count).toBe(pagesBefore[0]?.count);
			expect(rootAfter).toMatchObject({
				direct_child_dir_count: rootBefore.direct_child_dir_count,
				direct_page_count: rootBefore.direct_page_count,
				descendant_page_count: rootBefore.descendant_page_count,
			});
			// twitter.com must still be excluded after a rebuild, not accumulate
			// duplicate/orphaned rows from the dropped-and-recreated tables.
			expect(
				await knex('viewer_directory_nodes').where('root_key', 'twitter.com').select('*'),
			).toEqual([]);
		});
	});

	describe('external links population', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_external_links__',
		);
		const archiveFilePath = path.resolve(workingDir, 'external-links-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

			// Two anchors on the same page to the same destination — must count
			// as one referrer in viewer_external_links, not two.
			await archive.setPage({
				url: parseUrl('https://example.com/page-a')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '',
				meta: META,
				anchorList: [
					{
						href: parseUrl('https://ads.example.com/')!,
						isExternal: true,
						title: null,
						textContent: 'Ad banner',
					},
					{
						href: parseUrl('https://ads.example.com/')!,
						isExternal: true,
						title: null,
						textContent: 'Ad footer',
					},
				],
				imageList: [],
				isSkipped: false,
			});

			// A second, distinct referring page to the same destination, plus two
			// duplicate anchors to a broken destination — must collapse to one
			// viewer_anchor_facts row with count=2, not two rows.
			await archive.setPage({
				url: parseUrl('https://example.com/page-b')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '',
				meta: META,
				anchorList: [
					{
						href: parseUrl('https://ads.example.com/')!,
						isExternal: true,
						title: null,
						textContent: 'Ad sidebar',
					},
					{
						href: parseUrl('https://example.com/broken')!,
						isExternal: false,
						title: null,
						textContent: 'Broken link 1',
					},
					{
						href: parseUrl('https://example.com/broken')!,
						isExternal: false,
						title: null,
						textContent: 'Broken link 2',
					},
				],
				imageList: [],
				isSkipped: false,
			});

			await archive.setPage({
				url: parseUrl('https://ads.example.com/')!,
				redirectPaths: [],
				isExternal: true,
				isTarget: false,
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

			await buildViewerReadModel(archive);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('populates viewer_external_links with one row per unique canonical destination', async () => {
			const rows = await archive
				.getKnex()('viewer_external_links')
				.join(
					'viewer_url_refs',
					'viewer_external_links.dest_url_ref_id',
					'viewer_url_refs.id',
				)
				.select('viewer_external_links.*', 'viewer_url_refs.url as dest_url');
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				dest_url: 'https://ads.example.com',
				status: 200,
				referrer_count: 2,
			});
		});

		it('rebuilds viewer_external_links idempotently — a second build leaves the same row count', async () => {
			await buildViewerReadModel(archive);
			const rows = await archive.getKnex()('viewer_external_links').select('*');
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ referrer_count: 2 });
		});

		it('populates viewer_anchor_facts with one row per unique (source,dest) pair, collapsing duplicate anchors via count', async () => {
			const rows = await archive
				.getKnex()('viewer_anchor_facts')
				.join(
					'viewer_url_refs',
					'viewer_anchor_facts.dest_url_ref_id',
					'viewer_url_refs.id',
				)
				.where('viewer_url_refs.url', 'https://example.com/broken')
				.select('viewer_anchor_facts.*');
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ count: 2, is_broken: 1, is_external_link: 0 });
		});

		it('flags the external-destination edges as is_external_link without indexing them for read (no vaf_external_* index exists)', async () => {
			const rows = await archive
				.getKnex()('viewer_anchor_facts')
				.join(
					'viewer_url_refs',
					'viewer_anchor_facts.dest_url_ref_id',
					'viewer_url_refs.id',
				)
				.where('viewer_url_refs.url', 'https://ads.example.com')
				.select('viewer_anchor_facts.*');
			expect(rows).toHaveLength(2);
			for (const row of rows) {
				expect(row).toMatchObject({ is_broken: 0, is_external_link: 1 });
			}
		});

		it('rebuilds viewer_anchor_facts idempotently — a second build leaves the same row count', async () => {
			await buildViewerReadModel(archive);
			const rows = await archive.getKnex()('viewer_anchor_facts').select('*');
			// 2 edges to ads.example.com (page-a, page-b) + 1 edge to /broken (page-b).
			expect(rows).toHaveLength(3);
		});
	});

	describe('viewer_url_refs scale regression', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_url_refs_scale__',
		);
		const archiveFilePath = path.resolve(workingDir, 'url-refs-scale-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

			await archive.setPage({
				url: parseUrl('https://example.com/broken-shared')!,
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

			for (let index = 0; index < 120; index++) {
				const padded = String(index).padStart(4, '0');
				const sourceUrl = `https://example.com/source-${padded}`;
				const externalUrl = `https://external-${padded}.example.net/landing`;
				await archive.setPage({
					url: parseUrl(externalUrl)!,
					redirectPaths: [],
					isExternal: true,
					isTarget: false,
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
				await archive.setPage({
					url: parseUrl(sourceUrl)!,
					redirectPaths: [],
					isExternal: false,
					isTarget: true,
					status: 200,
					statusText: 'OK',
					contentType: 'text/html',
					contentLength: 100,
					responseHeaders: {},
					html: '',
					meta: { ...META, title: `Source ${padded}` },
					anchorList: [
						{
							href: parseUrl(externalUrl)!,
							isExternal: true,
							title: null,
							textContent: `External ${padded}`,
						},
						{
							href: parseUrl('https://example.com/broken-shared')!,
							isExternal: false,
							title: null,
							textContent: `Broken ${padded}`,
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
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('builds URL refs for many distinct URLs and keeps fast-path URL restoration working', async () => {
			const refCountRows = await archive
				.getKnex()('viewer_url_refs')
				.count<{ count: string }[]>({ count: '*' });
			expect(Number(refCountRows[0]?.count)).toBe(241);

			const external = await listViewerExternalLinks(archive, { limit: 5 });
			expect(external.total).toBe(120);
			expect(external.items[0]?.destUrl).toBe(
				'https://external-0000.example.net/landing',
			);

			const broken = await listViewerBrokenLinks(archive, { limit: 5 });
			expect(broken.total).toBe(120);
			expect(broken.items[0]).toMatchObject({
				destUrl: 'https://example.com/broken-shared',
				status: 404,
				isExternal: false,
			});
		});
	});

	describe('viewer_summary population', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_summary__',
		);
		const archiveFilePath = path.resolve(workingDir, 'summary-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

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
				meta: { ...META, title: 'Home', description: 'Home description' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});

			await archive.setPage({
				url: parseUrl('https://example.net/')!,
				redirectPaths: [],
				isExternal: true,
				isTarget: false,
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

			// status=-1 (hard failure) — the only shape that makes getSummary()
			// attach an `errorKindBreakdown` array onto the `-1` StatusCount
			// entry. Exercises that nested array surviving the JSON.stringify /
			// JSON.parse round-trip through viewer_summary.status_json, which a
			// fixture with only 200/404 pages (both empty errorKindBreakdown)
			// would never catch if a future change to the serialisation broke it.
			await archive.setPage({
				url: parseUrl('https://example.com/broken')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: -1,
				statusText: 'ERR_NAME_NOT_RESOLVED',
				contentType: null,
				contentLength: null,
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
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('writes a single viewer_summary row matching a getSummary() snapshot of the same archive', async () => {
			const expected = await getSummary(archive);
			await buildViewerReadModel(archive);

			const knex = archive.getKnex();
			const rows = await knex('viewer_summary').select('*');
			expect(rows).toHaveLength(1);
			const row = rows[0]!;
			expect(row).toMatchObject({
				id: 1,
				total_pages: expected.totalPages,
				internal_pages: expected.internalPages,
				external_pages: expected.externalPages,
				internal_contents: expected.internalContents,
				external_contents: expected.externalContents,
			});
			expect(JSON.parse(row.status_json as string)).toEqual(expected.statusDistribution);
			expect(JSON.parse(row.content_type_json as string)).toEqual(
				expected.contentTypeDistribution,
			);
			expect(JSON.parse(row.metadata_json as string)).toEqual(
				expected.metadataFulfillment,
			);
		});

		it("computes the fixture's counts/distributions independently of getSummary() (hardcoded expectations)", async () => {
			// Cross-checking against a live getSummary() call (the test above)
			// proves the two implementations agree, but would not catch a bug
			// shared by both. These hardcoded literals — derived by hand from
			// the 3-page fixture above (home: 200/internal/html/full-metadata,
			// example.net: 404/external/html, broken: -1/internal/null-contentType)
			// — pin the actual expected values independently.
			await buildViewerReadModel(archive);
			const row = await archive.getKnex()('viewer_summary').where('id', 1).first();

			expect(row).toMatchObject({
				total_pages: 3,
				internal_pages: 2,
				external_pages: 1,
				internal_contents: 2,
				external_contents: 1,
			});

			const statusDistribution: { status: number | null; count: number }[] = JSON.parse(
				row.status_json as string,
			);
			expect(
				statusDistribution.map((e) => ({ status: e.status, count: e.count })),
			).toEqual([
				{ status: -1, count: 1 },
				{ status: 200, count: 1 },
				{ status: 404, count: 1 },
			]);

			const contentTypeDistribution: {
				category: string;
				internal: number;
				external: number;
			}[] = JSON.parse(row.content_type_json as string);
			expect(contentTypeDistribution).toEqual([
				{ category: 'html', internal: 1, external: 1 },
				{ category: 'unknown', internal: 1, external: 0 },
			]);

			// Only the internal text/html page ("home") counts toward metadata
			// fulfillment; it has a title and description but no og:title.
			expect(JSON.parse(row.metadata_json as string)).toEqual({
				title: 1,
				description: 1,
				keywords: 0,
				ogTitle: 0,
				ogDescription: 0,
				ogImage: 0,
			});
		});

		it("round-trips the status=-1 entry's errorKindBreakdown through status_json intact", async () => {
			const expected = await getSummary(archive);
			const minusOne = expected.statusDistribution.find((e) => e.status === -1);
			expect(minusOne?.errorKindBreakdown?.length).toBeGreaterThan(0);

			await buildViewerReadModel(archive);
			const row = await archive.getKnex()('viewer_summary').where('id', 1).first();
			const statusDistribution: typeof expected.statusDistribution = JSON.parse(
				row.status_json as string,
			);
			const roundTripped = statusDistribution.find((e) => e.status === -1);
			expect(roundTripped).toEqual(minusOne);
		});

		it('rebuilds viewer_summary idempotently — a second build leaves exactly one row', async () => {
			await buildViewerReadModel(archive);
			await buildViewerReadModel(archive);
			const rows = await archive.getKnex()('viewer_summary').select('*');
			expect(rows).toHaveLength(1);
		});
	});

	describe('viewer_error_kind_* population (issue #118)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_error_kinds__',
		);
		const archiveFilePath = path.resolve(workingDir, 'error-kinds-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		/**
		 * Build a `CrawlerError` for the crawler-level `error` channel.
		 * @param url - The URL the error is about, or `null` for a process-level error.
		 * @param message - The raw error message.
		 * @param isExternal - Whether the URL is external.
		 * @returns A `CrawlerError` accepted by `Archive.addError`.
		 */
		function crawlerError(
			url: string | null,
			message: string,
			isExternal = false,
		): CrawlerError {
			return { pid: 1, isMainProcess: true, url, isExternal, error: new Error(message) };
		}

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

			await archive.addPageError(
				'https://example.com/slow',
				'retryExhausted',
				'gave up after 3 retries — Race 180,000ms vs Scraper.#fetchData',
				false,
			);
			await archive.addError(
				crawlerError(
					'http://ext.example.net/x',
					'getaddrinfo ENOTFOUND ext.example.net',
					true,
				),
			);
			await archive.addError(
				crawlerError(
					'https://api.example.org/',
					'connect ECONNREFUSED 10.0.0.1:443',
					true,
				),
			);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('writes one viewer_error_kind_entries row per host×kind pair, matching getErrorKinds()', async () => {
			const expected = await getErrorKinds(archive);
			await buildViewerReadModel(archive);

			const knex = archive.getKnex();
			// This fixture's 3 host×kind pairs all tie at count 1 — sort by
			// host+kind before comparing since `ORDER BY count` alone leaves
			// ties in an order that need not match `getErrorKinds`'s
			// Map-insertion-order tie-break (see `get-viewer-error-kinds.spec.ts`
			// for the same note).
			const entries = await knex('viewer_error_kind_entries')
				.select('host', 'kind', 'count')
				.orderBy('host');
			expect(entries).toEqual(
				expected.items
					.map((item) => ({ host: item.host, kind: item.kind, count: item.count }))
					.toSorted((a, b) => a.host.localeCompare(b.host)),
			);
		});

		it('writes sample_urls_json/overflowed_count for the example.com/timeout pair', async () => {
			await buildViewerReadModel(archive);
			const knex = archive.getKnex();

			const row = await knex('viewer_error_kind_entries')
				.where({ host: 'example.com', kind: 'timeout' })
				.first();
			expect(row).toMatchObject({ count: 1, overflowed_count: 0 });
			expect(JSON.parse(row.sample_urls_json)).toEqual(['https://example.com/slow']);
		});

		it('writes a single viewer_error_kind_meta row with total_records and channel_source', async () => {
			const expected = await getErrorKinds(archive);
			await buildViewerReadModel(archive);

			const meta = await archive
				.getKnex()('viewer_error_kind_meta')
				.where('id', 1)
				.first();
			expect(meta).toMatchObject({
				total_records: expected.facets.totalRecords,
				channel_source: expected.facets.channelSource,
			});
		});

		it('rebuilds idempotently — a second build leaves the same row counts, not duplicates', async () => {
			await buildViewerReadModel(archive);
			await buildViewerReadModel(archive);

			const knex = archive.getKnex();
			const entries = await knex('viewer_error_kind_entries').select('*');
			const meta = await knex('viewer_error_kind_meta').select('*');
			expect(entries).toHaveLength(3);
			expect(meta).toHaveLength(1);
		});
	});

	describe('viewer_error_kind_entries chunked insert with many distinct hosts', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_error_kinds_many_hosts__',
		);
		const archiveFilePath = path.resolve(
			workingDir,
			'error-kinds-many-hosts-test.nitpicker',
		);
		let archive: InstanceType<typeof Archive>;

		// Exceeds buildViewerReadModel's 500-row INSERT_CHUNK_SIZE so inserting
		// them all as a single `.insert()` call could risk exceeding the
		// SQLite/libsql bound-parameter ceiling — a real crawl can fail
		// against many thousands of distinct hosts, each becoming its own
		// `viewer_error_kind_entries` row.
		const HOST_COUNT = 600;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

			// Bulk raw insert (not HOST_COUNT sequential addError() calls) for
			// test speed — same technique as this file's other large-fixture
			// blocks (see "onProgress: multiple chunks" above). Inserted in
			// sub-batches of ≤500 rows — unrelated to buildViewerReadModel's own
			// 500-row INSERT_CHUNK_SIZE this test exists to exercise — because
			// SQLite's compound-SELECT term limit (default 500) rejects a single
			// `.insert()` call carrying all 600 rows at once.
			const knex = archive.getKnex();
			const rows = Array.from({ length: HOST_COUNT }, (_, i) => ({
				url: `http://ext-${i}.example.net/`,
				isExternal: 1,
				message: `getaddrinfo ENOTFOUND ext-${i}.example.net`,
				createdAt: Date.now(),
			}));
			await knex('crawl_errors').insert(rows.slice(0, 400));
			await knex('crawl_errors').insert(rows.slice(400));
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('builds successfully and writes one viewer_error_kind_entries row per distinct host', async () => {
			await expect(buildViewerReadModel(archive)).resolves.toBeUndefined();
			const knex = archive.getKnex();
			const entries = await knex('viewer_error_kind_entries')
				.where('kind', 'dns')
				.select('*');
			expect(entries).toHaveLength(HOST_COUNT);
			const meta = await knex('viewer_error_kind_meta').where('id', 1).first();
			expect(meta).toMatchObject({ total_records: HOST_COUNT });
		});
	});

	describe('empty archive: viewer_error_kind_* tables', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_error_kinds_empty__',
		);
		const archiveFilePath = path.resolve(workingDir, 'error-kinds-empty-test.nitpicker');
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('leaves viewer_error_kind_entries empty and writes a total_records=0/none meta row, without throwing on the empty-array insert guard', async () => {
			await expect(buildViewerReadModel(archive)).resolves.toBeUndefined();
			const knex = archive.getKnex();
			expect(await knex('viewer_error_kind_entries').select('*')).toHaveLength(0);
			const meta = await knex('viewer_error_kind_meta').where('id', 1).first();
			expect(meta).toMatchObject({ total_records: 0, channel_source: 'none' });
		});
	});

	describe('viewer_duplicate_groups / viewer_duplicate_group_pages / viewer_mismatches population (issue #115)', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_build_read_model_duplicates_mismatches__',
		);
		const archiveFilePath = path.resolve(
			workingDir,
			'duplicates-mismatches-test.nitpicker',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
			await archive.setConfig(BASE_CONFIG);

			// Title-duplicate group of 2.
			await archive.setPage({
				url: parseUrl('https://example.com/dup-a')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '',
				meta: { ...META, title: 'Duplicate Title' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
			await archive.setPage({
				url: parseUrl('https://example.com/dup-b')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '',
				meta: { ...META, title: 'Duplicate Title' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});

			// Singleton — must not surface as a duplicate group.
			await archive.setPage({
				url: parseUrl('https://example.com/unique')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '',
				meta: { ...META, title: 'Unique Title' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});

			// canonical mismatch.
			await archive.setPage({
				url: parseUrl('https://example.com/mismatch')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '',
				meta: {
					...META,
					title: 'Mismatch',
					link: { canonical: 'https://example.com/canonical-target' },
				},
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});

			await buildViewerReadModel(archive);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('populates viewer_duplicate_groups with one title-duplicate group, excluding the singleton', async () => {
			const knex = archive.getKnex();
			const groups = await knex('viewer_duplicate_groups').select('*');
			expect(groups).toHaveLength(1);
			expect(groups[0]).toMatchObject({
				field: 'title',
				value: 'Duplicate Title',
				count: 2,
				count_desc_key: -2,
			});
		});

		it('populates viewer_duplicate_group_pages with both member pages of the duplicate group', async () => {
			const knex = archive.getKnex();
			const group = await knex('viewer_duplicate_groups').first();
			const pages = await knex('viewer_duplicate_group_pages')
				.where('group_id', group.group_id)
				.select('url_sort_key');
			expect(pages.map((p) => p.url_sort_key).toSorted()).toEqual(
				['https://example.com/dup-a', 'https://example.com/dup-b'].toSorted(),
			);
		});

		it('populates viewer_mismatches with the canonical mismatch, and nothing for a page with no mismatches', async () => {
			const knex = archive.getKnex();
			const rows = await knex('viewer_mismatches').select('*');
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				type: 'canonical',
				url_sort_key: 'https://example.com/mismatch',
				actual: 'https://example.com/mismatch',
				expected: 'https://example.com/canonical-target',
			});
		});

		it('rebuilds idempotently — a second build leaves the same row counts, not duplicates', async () => {
			await buildViewerReadModel(archive);
			const knex = archive.getKnex();
			expect(await knex('viewer_duplicate_groups').select('*')).toHaveLength(1);
			expect(await knex('viewer_duplicate_group_pages').select('*')).toHaveLength(2);
			expect(await knex('viewer_mismatches').select('*')).toHaveLength(1);
		});
	});
});
