import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listPages } from '../list-pages.js';

import { buildViewerReadModel } from './build-viewer-read-model.js';
import { hasViewerReadModel } from './has-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.10.0',
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
});
