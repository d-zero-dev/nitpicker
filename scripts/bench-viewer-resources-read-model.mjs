#!/usr/bin/env node
/**
 * Benchmarks `/api/resources`'s and `/api/unused-resources`'s
 * `viewer_resources`/`viewer_resource_stats` read-model fast path (issue
 * #110) on a synthetic archive with tens of thousands of resource
 * records — no real customer archive is ever read or referenced.
 *
 * Records, mirroring `bench-viewer-pages-read-model.mjs`'s Benchmark
 * Contract:
 *
 *   - row count / read-model build time / added DB size
 *   - `listResources`/`listUnusedResources` (legacy, before) vs
 *     `listViewerResources`/`listViewerUnusedResources` (read-model, after)
 *     direct function-level cold timing, for the default (unfiltered) shape
 *   - `/api/resources` and `/api/unused-resources` cold HTTP timing through
 *     the real Hono app, once before and once after the read model exists
 *   - warm (repeated-request) p50/p95 timing and `EXPLAIN QUERY PLAN` for a
 *     filter/sort MATRIX run against `/api/resources` once the read model
 *     exists — including `urlPattern`, the raw-MIME-prefix `contentType`,
 *     and the `contentLength`/`referrerCount` `sortBy` values that moved
 *     onto the `viewer_resources` fast path (previously only `url`/`status`
 *     were fast-path-indexed sorts; `listResources`'s full `sortBy` surface
 *     is now served directly by `viewer_resources`, see
 *     `getViewerResourcesSortSpec`'s docs)
 *   - `/api/resources/referrers` is NOT read-model-dependent (see
 *     `get-resource-referrers.ts`'s docs — `resource_ref_edges` already has
 *     a `(resource_id, page_id)` primary key and a reverse-direction index
 *     on `page_id`) — this script only confirms that via
 *     `EXPLAIN QUERY PLAN`, no before/after split.
 *
 * Seeds through the real write path (`Archive.setPage`/`Archive.setResources`/
 * `Archive.setResourcesReferrers`, same as a live crawl) rather than raw
 * `INSERT`s against a hand-picked table shape — the writer moved to the 0.13
 * `content_items`/`resource_items`/`resource_ref_edges` entity tables (issue
 * #196, 2026-07-16) and there is no `pages`/`resources`/`resources-referrers`
 * table in a fresh archive to seed directly. This is slower to seed than a
 * raw bulk `INSERT` but guarantees the synthetic archive matches what
 * `buildViewerReadModel` and `listResources`/`listUnusedResources` actually
 * read from in production.
 *
 * USAGE
 * -----
 *
 *     yarn build && node scripts/bench-viewer-resources-read-model.mjs
 *
 * Sizes default to {20,000}; override via `BENCH_SIZES=…` (comma
 * separated) — kept an order of magnitude below `bench-viewer-pages-read-model.mjs`'s
 * default because seeding here costs two writes per referenced resource
 * (`setResources` + `setResourcesReferrers`) plus the referring-page pool,
 * all through the real write path with no bulk-insert shortcut. Always
 * disk-backed (never `:memory:`) — the whole point is measuring realistic
 * cold-cache I/O, which an in-memory DB can't produce.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';

import { applyViewerResourcesFilters } from '../packages/@nitpicker/query/lib/apply-viewer-resources-filters.js';
import { listResources } from '../packages/@nitpicker/query/lib/list-resources.js';
import { listUnusedResources } from '../packages/@nitpicker/query/lib/list-unused-resources.js';
import { listViewerResources } from '../packages/@nitpicker/query/lib/list-viewer-resources.js';
import { listViewerUnusedResources } from '../packages/@nitpicker/query/lib/list-viewer-unused-resources.js';
import { buildViewerReadModel } from '../packages/@nitpicker/query/lib/viewer-read-model/build-viewer-read-model.js';
import { getViewerResourcesSortSpec } from '../packages/@nitpicker/query/lib/viewer-resources-cursor/get-viewer-resources-sort-spec.js';
import { createApp } from '../packages/@nitpicker/viewer/lib/create-app.js';

const SIZES = process.env.BENCH_SIZES
	? process.env.BENCH_SIZES.split(',').map((s) => Number(s.trim()))
	: [20_000];

/** Repeated warm requests per matrix entry, for p50/p95. */
const WARM_ITERATIONS = 20;

/** Referring-page pool size — real `content_items` rows for `resource_ref_edges.page_id`. */
const PAGE_POOL_SIZE = 500;

/** Raw MIME types cycled across seeded resources, with a matching file extension for readable URLs. */
const CONTENT_TYPES = [
	{ mime: 'application/javascript', ext: 'js' },
	{ mime: 'text/css', ext: 'css' },
	{ mime: 'image/png', ext: 'png' },
	{ mime: 'font/woff2', ext: 'woff2' },
];

/**
 * Filter/sort combinations benchmarked against `/api/resources` — the
 * pre-existing `url`/`status` fast-path sorts plus every filter/sort this
 * PR moves onto the `viewer_resources` fast path: the LIKE-based
 * `urlPattern`, the raw-MIME-prefix `contentType`, and the
 * `contentLength`/`referrerCount` `sortBy` values (previously live-only —
 * see `getViewerResourcesSortSpec`'s docs).
 */
const RESOURCES_MATRIX = [
	{ label: 'default', query: 'limit=100', options: {} },
	{
		label: 'urlPattern=%25resource-1%25',
		query: 'limit=100&urlPattern=%25resource-1%25',
		options: { urlPattern: '%resource-1%' },
	},
	{
		label: 'contentType=application/javascript',
		query: `limit=100&contentType=${encodeURIComponent('application/javascript')}`,
		options: { contentType: 'application/javascript' },
	},
	{
		label: 'isExternal=0',
		query: 'limit=100&isExternal=false',
		options: { isExternal: false },
	},
	{ label: 'status=200', query: 'limit=100&status=200', options: { status: 200 } },
	{
		label: 'sort=contentLength:desc',
		query: 'limit=100&sortBy=contentLength&sortOrder=desc',
		options: { sortBy: 'contentLength', sortOrder: 'desc' },
	},
	{
		label: 'sort=referrerCount:desc',
		query: 'limit=100&sortBy=referrerCount&sortOrder=desc',
		options: { sortBy: 'referrerCount', sortOrder: 'desc' },
	},
	{
		label: 'sort=status:asc',
		query: 'limit=100&sortBy=status&sortOrder=asc',
		options: { sortBy: 'status', sortOrder: 'asc' },
	},
];

/**
 * Materialises a disk-backed synthetic archive seeded through the real
 * write path (`Archive.setPage` for the referring-page pool,
 * `Archive.setResources`/`Archive.setResourcesReferrers` for the resources
 * under test), spanning every facet `/api/resources`/`/api/unused-resources`
 * support: a realistic mix of ~60% referenced-internal, ~25%
 * unreferenced-internal (the "unused" candidates), ~15% external resources,
 * a handful of raw MIME types, a minority 404 status, and a `compress`/`cdn`
 * population.
 * @param {number} n - The number of resource rows to seed.
 * @returns {Promise<{accessor: import('@nitpicker/crawler').ArchiveAccessor, dbFilePath: string, cleanupDir: string}>}
 *   The seeded, still-open archive (for `getKnex()`) and its backing dir (for size + cleanup).
 */
async function makeDb(n) {
	const cleanupDir = path.join(
		tmpdir(),
		`nitpicker-bench-viewer-resources-${n}-${process.pid}`,
	);
	const filePath = path.join(cleanupDir, 'archive.nitpicker');
	rmSync(cleanupDir, { recursive: true, force: true });
	mkdirSync(cleanupDir, { recursive: true });

	const archive = await Archive.create({ filePath, cwd: cleanupDir });
	await archive.setConfig({
		baseUrl: 'https://example.com',
		name: 'bench-viewer-resources',
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
		userAgent: 'bench',
		ignoreRobots: false,
	});

	// Referring-page pool first — `Archive.setResourcesReferrers`'s
	// `resolveContentItemId` silently creates a bare `content_items` stub for
	// an unknown page URL, but seeding real pages here keeps the referrer
	// graph the same shape a live crawl produces (a referrer is always a
	// fully-scraped HTML page), matching this bench's "seed through the real
	// write path" contract.
	const pagePool = [];
	for (let i = 0; i < PAGE_POOL_SIZE; i++) {
		const url = `https://example.com/referrer-page-${i}`;
		await archive.setPage({
			url: parseUrl(url),
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 1000,
			responseHeaders: {},
			html: `<html><head><title>Referrer ${i}</title></head><body>Referrer ${i}</body></html>`,
			mainContents: null,
			scrollHeight: null,
			meta: { title: `Referrer Page ${i}` },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		pagePool.push(url);
	}

	// Bucket layout per 20-row cycle: [0,12) referenced-internal, [12,17)
	// unreferenced-internal (the "unused" candidates), [17,20) external —
	// same proportions the pre-rewrite raw-`INSERT` seeding used.
	for (let i = 0; i < n; i++) {
		const bucket = i % 20;
		const isExternal = bucket >= 17;
		const isReferenced = bucket < 12;
		const { mime, ext } = CONTENT_TYPES[i % CONTENT_TYPES.length];
		const isError = i % 25 === 0;
		const url = `https://${isExternal ? 'cdn.example.net' : 'example.com'}/resource-${i}.${ext}`;
		await archive.setResources({
			url: parseUrl(url),
			isExternal,
			isError,
			status: isError ? 404 : 200,
			statusText: isError ? 'Not Found' : 'OK',
			contentType: mime,
			contentLength: 500 + ((i * 37) % 50_000),
			compress: i % 4 === 0 ? 'gzip' : false,
			cdn: i % 6 === 0 ? 'Cloudflare' : false,
			headers: {},
		});
		if (isReferenced) {
			await archive.setResourcesReferrers({
				url: pagePool[i % PAGE_POOL_SIZE],
				src: url,
			});
		}
	}

	// `Archive.create`'s tmpDir is `<cwd>/._nitpicker-<basename-without-ext>`
	// (see `Archive.create`'s own `tmpDir` derivation) — same convention
	// `bench-viewer-pages-read-model.mjs`'s `makeDb` documents.
	const dbFilePath = path.join(cleanupDir, '._nitpicker-archive', 'db.sqlite');
	return { accessor: archive, dbFilePath, cleanupDir };
}

/**
 * Runs `EXPLAIN QUERY PLAN` for one `RESOURCES_MATRIX` entry's
 * id-resolution query against `viewer_resources`, built the same way
 * `list-viewer-resources.ts`'s `readViewerResourcesWindow` does (reusing the
 * production `applyViewerResourcesFilters`/`getViewerResourcesSortSpec`
 * helpers, not a hand-duplicated SQL string).
 * @param {import('knex').Knex} db - The Knex instance.
 * @param {object} options - The matrix entry's `ListViewerResourcesOptions`.
 * @returns {Promise<string>} One `|`-joined line of `EXPLAIN QUERY PLAN` detail rows.
 */
async function explainResourcesMatrixEntry(db, options) {
	const sortBy = options.sortBy ?? 'url';
	const sortOrder = options.sortOrder ?? 'asc';
	const spec = getViewerResourcesSortSpec(sortBy, sortOrder);
	const qb = db('viewer_resources');
	applyViewerResourcesFilters(qb, options);
	const selectColumns = [...new Set(['resource_id', ...spec.columns])];
	const { sql, bindings } = qb
		.select(selectColumns)
		.orderBy(spec.columns.map((column) => ({ column, order: spec.scanDirection })))
		.limit(101)
		.toSQL();
	const plan = await db.raw(`EXPLAIN QUERY PLAN ${sql}`, bindings);
	return plan.map((row) => row.detail).join(' | ');
}

/**
 * Times `iterations` sequential HTTP round-trips through the real Hono app
 * for one query string, returning p50/p95 in milliseconds.
 * @param {import('hono').Hono} app - The app under test.
 * @param {string} query - The `/api/resources` query string (no leading `?`).
 * @param {number} iterations - Number of warm requests to time.
 * @returns {Promise<{p50: number, p95: number}>} Warm latency percentiles.
 */
async function timeWarmRequests(app, query, iterations) {
	const timings = [];
	for (let i = 0; i < iterations; i++) {
		const start = process.hrtime.bigint();
		const res = await app.request(`/api/resources?${query}`);
		await res.text();
		timings.push(Number(process.hrtime.bigint() - start) / 1e6);
	}
	timings.sort((a, b) => a - b);
	const p50 = timings[Math.floor(timings.length * 0.5)];
	const p95 = timings[Math.floor(timings.length * 0.95)];
	return { p50, p95 };
}

/**
 * Runs `RESOURCES_MATRIX` (EXPLAIN + cold/warm HTTP timing) against the
 * fast-path app once the read model is built, printing a results table and
 * a copy-pasteable Markdown summary block — same shape as
 * `bench-viewer-pages-read-model.mjs`'s `runMatrix`.
 * @param {import('knex').Knex} db - The archive's Knex instance.
 * @param {import('hono').Hono} fastApp - The Hono app wired to the
 *   read-model-backed accessor.
 */
async function runResourcesMatrix(db, fastApp) {
	const results = [];
	for (const entry of RESOURCES_MATRIX) {
		const explain = await explainResourcesMatrixEntry(db, entry.options);
		const coldStart = process.hrtime.bigint();
		const coldRes = await fastApp.request(`/api/resources?${entry.query}`);
		await coldRes.text();
		const coldMs = Number(process.hrtime.bigint() - coldStart) / 1e6;
		const { p50, p95 } = await timeWarmRequests(fastApp, entry.query, WARM_ITERATIONS);
		results.push({ ...entry, coldMs, p50, p95, explain });
	}

	console.log('\n  /api/resources filter/sort                cold      p50      p95');
	for (const r of results) {
		console.log(
			`  ${r.label.padEnd(40)} ${`${r.coldMs.toFixed(1)}ms`.padStart(8)} ${`${r.p50.toFixed(1)}ms`.padStart(8)} ${`${r.p95.toFixed(1)}ms`.padStart(8)}`,
		);
		console.log(`      EXPLAIN: ${r.explain}`);
	}

	console.log(
		'\n### Markdown summary — /api/resources filter/sort matrix (paste into PR/ARCHITECTURE.md, no archive-identifying details)\n',
	);
	console.log('| filter/sort | cold | warm p50 | warm p95 | EXPLAIN QUERY PLAN |');
	console.log('| --- | --- | --- | --- | --- |');
	for (const r of results) {
		console.log(
			`| ${r.label} | ${r.coldMs.toFixed(1)}ms | ${r.p50.toFixed(1)}ms | ${r.p95.toFixed(1)}ms | ${r.explain} |`,
		);
	}
}

/**
 * Builds a Hono app wired to one `archiveId` mapped to the given accessor.
 * @param {import('@nitpicker/crawler').ArchiveAccessor} accessor - The accessor to serve.
 * @param {string} archiveId - Unique id for this phase.
 * @returns {import('hono').Hono} The configured app.
 */
function makeApp(accessor, archiveId) {
	return createApp({
		context: { archiveId, manager: { get: () => accessor }, mode: 'archive' },
		publicDir: '/tmp/no-such-dir-bench',
	});
}

for (const n of SIZES) {
	console.log(
		`\n══════════ ${n.toLocaleString()} resources (seeded via Archive.setResources) ══════════`,
	);
	const seedStart = process.hrtime.bigint();
	const { accessor, dbFilePath, cleanupDir } = await makeDb(n);
	console.log(
		`  seed time: ${(Number(process.hrtime.bigint() - seedStart) / 1e6).toFixed(0)}ms`,
	);
	try {
		const seedSizeBytes = statSync(dbFilePath).size;
		console.log(`  seeded DB size: ${(seedSizeBytes / 1024 / 1024).toFixed(1)} MiB`);

		// BEFORE: legacy direct calls (correlated subquery / anti-join).
		const legacyResourcesStart = process.hrtime.bigint();
		const legacyResources = await listResources(accessor, { limit: 100 });
		const legacyResourcesMs =
			Number(process.hrtime.bigint() - legacyResourcesStart) / 1e6;
		console.log(`  direct listResources() (legacy): ${legacyResourcesMs.toFixed(1)}ms`);

		const legacyUnusedStart = process.hrtime.bigint();
		const legacyUnused = await listUnusedResources(accessor, { limit: 100 });
		const legacyUnusedMs = Number(process.hrtime.bigint() - legacyUnusedStart) / 1e6;
		console.log(
			`  direct listUnusedResources() (legacy): ${legacyUnusedMs.toFixed(1)}ms`,
		);

		const legacyApp = makeApp(accessor, 'bench-legacy');
		const legacyHttpResourcesStart = process.hrtime.bigint();
		const legacyResourcesRes = await legacyApp.request('/api/resources');
		await legacyResourcesRes.text();
		const legacyHttpResourcesMs =
			Number(process.hrtime.bigint() - legacyHttpResourcesStart) / 1e6;
		const legacyHttpUnusedStart = process.hrtime.bigint();
		const legacyUnusedRes = await legacyApp.request('/api/unused-resources');
		await legacyUnusedRes.text();
		const legacyHttpUnusedMs =
			Number(process.hrtime.bigint() - legacyHttpUnusedStart) / 1e6;
		console.log(
			`  HTTP /api/resources (legacy): ${legacyHttpResourcesMs.toFixed(1)}ms  /api/unused-resources: ${legacyHttpUnusedMs.toFixed(1)}ms`,
		);

		// Build the read model.
		const sizeBeforeBytes = statSync(dbFilePath).size;
		const buildStart = process.hrtime.bigint();
		await buildViewerReadModel(accessor);
		const buildMs = Number(process.hrtime.bigint() - buildStart) / 1e6;
		const sizeAfterBytes = statSync(dbFilePath).size;
		console.log(`  read-model build time: ${buildMs.toFixed(0)}ms`);
		console.log(
			`  read-model added DB size: ${((sizeAfterBytes - sizeBeforeBytes) / 1024 / 1024).toFixed(1)} MiB`,
		);

		// AFTER: read-model direct calls.
		const fastResourcesStart = process.hrtime.bigint();
		const fastResources = await listViewerResources(accessor, { limit: 100 });
		const fastResourcesMs = Number(process.hrtime.bigint() - fastResourcesStart) / 1e6;
		console.log(
			`  direct listViewerResources() (read model): ${fastResourcesMs.toFixed(1)}ms`,
		);

		const fastUnusedStart = process.hrtime.bigint();
		const fastUnused = await listViewerUnusedResources(accessor, { limit: 100 });
		const fastUnusedMs = Number(process.hrtime.bigint() - fastUnusedStart) / 1e6;
		console.log(
			`  direct listViewerUnusedResources() (read model): ${fastUnusedMs.toFixed(1)}ms`,
		);

		const fastApp = makeApp(accessor, 'bench-read-model');
		const fastHttpResourcesStart = process.hrtime.bigint();
		const fastResourcesRes = await fastApp.request('/api/resources');
		await fastResourcesRes.text();
		const fastHttpResourcesMs =
			Number(process.hrtime.bigint() - fastHttpResourcesStart) / 1e6;
		const fastHttpUnusedStart = process.hrtime.bigint();
		const fastUnusedRes = await fastApp.request('/api/unused-resources');
		await fastUnusedRes.text();
		const fastHttpUnusedMs = Number(process.hrtime.bigint() - fastHttpUnusedStart) / 1e6;
		console.log(
			`  HTTP /api/resources (read model): ${fastHttpResourcesMs.toFixed(1)}ms  /api/unused-resources: ${fastHttpUnusedMs.toFixed(1)}ms`,
		);

		const db = accessor.getKnex();
		const unusedPlan = await db.raw(
			'EXPLAIN QUERY PLAN select resource_id from viewer_resources where is_unused = 1 order by url_sort_key, resource_id limit 100',
		);
		const referrersPlan = await db.raw(
			'EXPLAIN QUERY PLAN select "page_ur"."url" from "resource_ref_edges" as "rre" join "content_items" as "ci" on "ci"."id" = "rre"."page_id" join "url_refs" as "page_ur" on "page_ur"."id" = "ci"."url_id" where "rre"."resource_id" = 1 and "rre"."page_id" > 0 order by "rre"."page_id" asc limit 101',
		);
		console.log(
			`  EXPLAIN (viewer_resources is_unused=1): ${unusedPlan.map((row) => row.detail).join(' | ')}`,
		);
		console.log(
			`  EXPLAIN (resource_ref_edges referrers, unaffected by this read model): ${referrersPlan.map((row) => row.detail).join(' | ')}`,
		);

		// Sanity check — both backends must agree on total counts.
		if (legacyResources.total !== fastResources.total) {
			throw new Error(
				`legacy listResources() and listViewerResources() disagree on total: ${legacyResources.total} vs ${fastResources.total}`,
			);
		}
		if (legacyUnused.total !== fastUnused.total) {
			throw new Error(
				`legacy listUnusedResources() and listViewerUnusedResources() disagree on total: ${legacyUnused.total} vs ${fastUnused.total}`,
			);
		}

		// Filter/sort matrix — including the urlPattern/contentType/new-sortBy
		// entries the `viewer_resources` fast path serves.
		await runResourcesMatrix(db, fastApp);

		console.log(
			'\n### Markdown summary — before/after (paste into PR/CLAUDE.md, no archive-identifying details)\n',
		);
		console.log(
			`\`${n.toLocaleString()} synthetic resources\` — viewer_resources/viewer_resource_stats fast path:\n`,
		);
		console.log('| endpoint | phase | direct call | HTTP |');
		console.log('| --- | --- | --- | --- |');
		console.log(
			`| /api/resources | legacy (before) | ${legacyResourcesMs.toFixed(1)}ms | ${legacyHttpResourcesMs.toFixed(1)}ms |`,
		);
		console.log(
			`| /api/resources | read model (after) | ${fastResourcesMs.toFixed(1)}ms | ${fastHttpResourcesMs.toFixed(1)}ms |`,
		);
		console.log(
			`| /api/unused-resources | legacy (before) | ${legacyUnusedMs.toFixed(1)}ms | ${legacyHttpUnusedMs.toFixed(1)}ms |`,
		);
		console.log(
			`| /api/unused-resources | read model (after) | ${fastUnusedMs.toFixed(1)}ms | ${fastHttpUnusedMs.toFixed(1)}ms |`,
		);
		console.log(`\nread-model build time: ${buildMs.toFixed(0)}ms`);
	} finally {
		// `releaseHandle()` (not `close()`): this bench never needs the
		// resulting `.nitpicker` tar, only the raw tmpDir's `db.sqlite` for
		// size stats above — see `bench-viewer-pages-read-model.mjs`'s same
		// cleanup comment for why `close()`'s implicit `write()` is unsafe here.
		await accessor.releaseHandle();
		rmSync(cleanupDir, { recursive: true, force: true });
	}
}
console.log('\nDone.');
