#!/usr/bin/env node
/**
 * Benchmarks `/api/pages`'s `viewer_pages` read-model fast path (issue
 * #106) on a synthetic archive with hundreds of thousands of content
 * records — no real customer archive is ever read or referenced.
 *
 * Records:
 *
 *   - row count / read-model build time / added DB size
 *   - `/api/pages` cold (first request after opening a fresh connection to
 *     the just-built DB file) and warm p50/p95 timing, per filter/sort
 *     combination
 *   - `EXPLAIN QUERY PLAN` for each combination's id-resolution query
 *
 * "Cold" here means "SQLite page cache empty for this DB file", not an OS
 * page-cache flush — the same convention this repo's other perf notes use
 * (see CLAUDE.md's `getSummary` cache note). Reused across a real HTTP
 * server process, request 2+ for a given shape is what "warm" means for
 * viewer users.
 *
 * Seeds through the real write path (`Archive.setPage`, same as a live
 * crawl) rather than raw `INSERT`s against a hand-picked table shape — the
 * writer moved to the 0.13 `content_items`/`page_meta` entity tables
 * (issue #196, 2026-07-16) and there is no `pages` table in a fresh archive
 * to seed directly. This is slower to seed than a raw bulk `INSERT` but
 * guarantees the synthetic archive matches what `buildViewerReadModel`
 * actually reads from in production.
 *
 * USAGE
 * -----
 *
 *     yarn build && node scripts/bench-viewer-pages-read-model.mjs
 *
 * Sizes default to {50,000}; override via `BENCH_SIZES=…` (comma
 * separated). Always disk-backed (never `:memory:`) — the whole point is
 * measuring realistic cold-cache I/O, which an in-memory DB can't produce.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';

import { applyViewerPagesFilters } from '../packages/@nitpicker/query/lib/apply-viewer-pages-filters.js';
import { listViewerPages } from '../packages/@nitpicker/query/lib/list-viewer-pages.js';
import { getViewerPagesSortSpec } from '../packages/@nitpicker/query/lib/viewer-pages-cursor/get-viewer-pages-sort-spec.js';
import { createApp } from '../packages/@nitpicker/viewer/lib/create-app.js';

const SIZES = process.env.BENCH_SIZES
	? process.env.BENCH_SIZES.split(',').map((s) => Number(s.trim()))
	: [50_000];

/** Repeated warm requests per matrix entry, for p50/p95. */
const WARM_ITERATIONS = 30;

/**
 * Filter/sort combinations benchmarked — every filter/sort combination the
 * `/api/pages` read-model fast path supports (see `ListViewerPagesOptions`),
 * plus the multi-select (OR checkbox, issue-9891406) `status` shape that
 * caused a real-archive regression (690ms vs. 109ms baseline, 2026-08-04)
 * and the `urlPattern`/header-presence filters the `/api/pages` fast path
 * serves.
 */
const MATRIX = [
	{ label: 'default', query: 'limit=100', options: {} },
	{
		label: 'isExternal=0',
		query: 'limit=100&isExternal=false',
		options: { isExternal: false },
	},
	{
		label: 'contentTypeCategory=html',
		query: 'limit=100&contentTypeCategory=html',
		options: { contentTypeCategory: 'html' },
	},
	{ label: 'status=200', query: 'limit=100&status=200', options: { status: 200 } },
	{
		label: 'status IN (200,301) [multi-select OR]',
		query: 'limit=100&status=200&status=301',
		options: { status: [200, 301] },
	},
	{
		label: 'status IN (200,301,404) [multi-select OR]',
		query: 'limit=100&status=200&status=301&status=404',
		options: { status: [200, 301, 404] },
	},
	{
		label: 'statusMin=400&statusMax=599',
		query: 'limit=100&statusMin=400&statusMax=599',
		options: { statusMin: 400, statusMax: 599 },
	},
	{
		label: 'missingTitle=1',
		query: 'limit=100&missingTitle=true',
		options: { missingTitle: true },
	},
	{
		label: 'missingDescription=1',
		query: 'limit=100&missingDescription=true',
		options: { missingDescription: true },
	},
	{ label: 'noindex=1', query: 'limit=100&noindex=true', options: { noindex: true } },
	{
		label: 'source=crawled',
		query: 'limit=100&source=crawled',
		options: { source: 'crawled' },
	},
	{
		label: 'urlPattern=%25page-1%25',
		query: 'limit=100&urlPattern=%25page-1%25',
		options: { urlPattern: '%page-1%' },
	},
	{
		label: 'lang=ja',
		query: 'limit=100&lang=ja',
		options: { lang: 'ja' },
	},
	{
		label: 'hasCSP=true',
		query: 'limit=100&hasCSP=true',
		options: { hasCSP: true },
	},
	{
		label: 'sort=status:desc',
		query: 'limit=100&sortBy=status&sortOrder=desc',
		options: { sortBy: 'status', sortOrder: 'desc' },
	},
	{
		label: 'sort=title:asc',
		query: 'limit=100&sortBy=title&sortOrder=asc',
		options: { sortBy: 'title', sortOrder: 'asc' },
	},
];

/**
 * Materialises a disk-backed synthetic archive seeded through the real
 * write path (`Archive.setPage`), spanning every facet/filter dimension
 * `/api/pages` supports — status mix (200/301/404/500/null), a minority
 * external / non-HTML / no-lang / missing-title / missing-description /
 * noindex / non-`crawled`-source / CSP-header population, matching
 * real-world skew (mostly-HTML, mostly-200, mostly-internal).
 * @param {number} n - The number of pages to seed.
 * @returns {Promise<{accessor: import('@nitpicker/crawler').ArchiveAccessor, dbFilePath: string, cleanupDir: string}>}
 *   The seeded, still-open archive (for `getKnex()`) and its backing dir (for size + cleanup).
 */
async function makeDb(n) {
	const cleanupDir = path.join(
		tmpdir(),
		`nitpicker-bench-viewer-pages-${n}-${process.pid}`,
	);
	const filePath = path.join(cleanupDir, 'archive.nitpicker');
	rmSync(cleanupDir, { recursive: true, force: true });
	mkdirSync(cleanupDir, { recursive: true });

	const archive = await Archive.create({ filePath, cwd: cleanupDir });
	await archive.setConfig({
		baseUrl: 'https://example.com',
		name: 'bench-viewer-pages',
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

	const STATUSES = [200, 200, 200, 200, 301, 404, 500, null];
	const CONTENT_TYPES = [
		...Array.from({ length: 18 }, () => 'text/html'),
		'application/pdf',
		null,
	];
	const LANGS = ['ja', 'en', null];
	const SOURCES = [
		...Array.from({ length: 9 }, () => 'crawled'),
		'inventory-seed',
		'inventory-discovered',
	];

	for (let i = 0; i < n; i++) {
		const padded = String(i).padStart(8, '0');
		const status = STATUSES[i % STATUSES.length];
		await archive.setPage(
			{
				url: parseUrl(`https://example.com/page-${padded}`),
				redirectPaths: [],
				isExternal: i % 10 === 0,
				isTarget: true,
				status,
				statusText: status ? 'OK' : '',
				contentType: CONTENT_TYPES[i % CONTENT_TYPES.length],
				contentLength: 1000,
				responseHeaders:
					i % 3 === 0
						? {
								'content-security-policy': "default-src 'self'",
								'x-frame-options': 'DENY',
							}
						: {},
				html: `<html><head><title>Page ${padded}</title></head><body>Page ${padded}</body></html>`,
				mainContents: null,
				scrollHeight: null,
				meta: {
					lang: LANGS[i % LANGS.length],
					title: i % 20 === 0 ? null : `Page ${padded}`,
					description: i % 7 === 0 ? null : `Synthetic page ${padded} for bench`,
					keywords: null,
					noindex: i % 15 === 0,
					nofollow: false,
					noarchive: false,
					canonical: null,
					alternate: null,
					'og:type': null,
					'og:title': `OG Page ${padded}`,
					'og:site_name': null,
					'og:description': null,
					'og:url': null,
					'og:image': null,
					'twitter:card': null,
				},
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			SOURCES[i % SOURCES.length] === 'crawled' ? undefined : SOURCES[i % SOURCES.length],
		);
	}

	// `Archive.create()` already returns a writable, open accessor (readOnly:
	// false) backed by a live tmpDir — `buildViewerReadModel` and the bench
	// queries below run directly against it. No write()+reopen round trip is
	// needed; `write()` only happens once at the very end (via `close()`'s
	// own "write if the target file doesn't exist yet" prologue), matching
	// `viewer-build`'s own open→build→write→close sequence.
	// `Archive.create`'s tmpDir is `<cwd>/._nitpicker-<basename-without-ext>`
	// (see `Archive.create`'s own `tmpDir` derivation) — not `cleanupDir`
	// itself, since a real archive's cwd can hold multiple in-flight tmpDirs.
	const dbFilePath = path.join(cleanupDir, '._nitpicker-archive', 'db.sqlite');
	return { accessor: archive, dbFilePath, cleanupDir, filePath };
}

/**
 * Builds the viewer read model against the seeded archive, timing the
 * build and measuring the DB file's size delta.
 * @param {import('@nitpicker/crawler').ArchiveAccessor} accessor - The opened archive accessor (must be writable — pass the `Archive.open` result, not a read-only cached one).
 * @param {string} dbFilePath - The DB's backing file path (for `statSync`).
 * @returns {Promise<{buildMs: number, sizeBeforeBytes: number, sizeAfterBytes: number}>}
 *   Build timing and size metrics.
 */
async function buildReadModel(accessor, dbFilePath) {
	const { buildViewerReadModel } =
		await import('../packages/@nitpicker/query/lib/viewer-read-model/build-viewer-read-model.js');
	const sizeBeforeBytes = statSync(dbFilePath).size;
	const start = process.hrtime.bigint();
	await buildViewerReadModel(accessor);
	const buildMs = Number(process.hrtime.bigint() - start) / 1e6;
	const sizeAfterBytes = statSync(dbFilePath).size;
	return { buildMs, sizeBeforeBytes, sizeAfterBytes };
}

/**
 * Runs `EXPLAIN QUERY PLAN` for one matrix entry's id-resolution query,
 * built the same way `list-viewer-pages.ts`'s `readViewerPagesWindow` does
 * (reusing the production `applyViewerPagesFilters` / `getViewerPagesSortSpec`
 * helpers, not a hand-duplicated SQL string).
 * @param {import('knex').Knex} db - The Knex instance.
 * @param {object} options - The matrix entry's `ListViewerPagesOptions`.
 * @returns {Promise<string>} One `|`-joined line of `EXPLAIN QUERY PLAN` detail rows.
 */
async function explainMatrixEntry(db, options) {
	const sortBy = options.sortBy ?? 'url';
	const sortOrder = options.sortOrder ?? 'asc';
	const spec = getViewerPagesSortSpec(sortBy, sortOrder);
	const qb = db('viewer_pages');
	applyViewerPagesFilters(qb, options);
	const selectColumns = [...new Set(['page_id', ...spec.columns])];
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
 * @param {string} query - The `/api/pages` query string (no leading `?`).
 * @param {number} iterations - Number of warm requests to time.
 * @returns {Promise<{p50: number, p95: number}>} Warm latency percentiles.
 */
async function timeWarmRequests(app, query, iterations) {
	const timings = [];
	for (let i = 0; i < iterations; i++) {
		const start = process.hrtime.bigint();
		const res = await app.request(`/api/pages?${query}`);
		await res.text();
		timings.push(Number(process.hrtime.bigint() - start) / 1e6);
	}
	timings.sort((a, b) => a - b);
	const p50 = timings[Math.floor(timings.length * 0.5)];
	const p95 = timings[Math.floor(timings.length * 0.95)];
	return { p50, p95 };
}

/**
 * Runs the full matrix (EXPLAIN + cold/warm HTTP timing) against one
 * already-built read model, printing a results table and a copy-pasteable
 * Markdown summary block.
 * @param {import('@nitpicker/crawler').ArchiveAccessor} accessor - The archive accessor with a built read model.
 * @param {number} n - The row count this DB was seeded with (for the report header).
 */
async function runMatrix(accessor, n) {
	const db = accessor.getKnex();
	const app = createApp({
		context: { archiveId: 'bench', manager: { get: () => accessor } },
		publicDir: '/tmp/no-such-dir-bench',
	});

	const results = [];
	for (const entry of MATRIX) {
		const explain = await explainMatrixEntry(db, entry.options);
		const coldStart = process.hrtime.bigint();
		const coldRes = await app.request(`/api/pages?${entry.query}`);
		await coldRes.text();
		const coldMs = Number(process.hrtime.bigint() - coldStart) / 1e6;
		const { p50, p95 } = await timeWarmRequests(app, entry.query, WARM_ITERATIONS);
		results.push({ ...entry, coldMs, p50, p95, explain });
	}

	console.log('\n  filter/sort                              cold      p50      p95');
	for (const r of results) {
		console.log(
			`  ${r.label.padEnd(40)} ${`${r.coldMs.toFixed(1)}ms`.padStart(8)} ${`${r.p50.toFixed(1)}ms`.padStart(8)} ${`${r.p95.toFixed(1)}ms`.padStart(8)}`,
		);
		console.log(`      EXPLAIN: ${r.explain}`);
	}

	console.log(
		'\n### Markdown summary (paste into PR/ARCHITECTURE.md, no archive-identifying details)\n',
	);
	console.log(
		`\`${n.toLocaleString()} synthetic rows\` — /api/pages viewer_pages fast path:\n`,
	);
	console.log('| filter/sort | cold | warm p50 | warm p95 | EXPLAIN QUERY PLAN |');
	console.log('| --- | --- | --- | --- | --- |');
	for (const r of results) {
		console.log(
			`| ${r.label} | ${r.coldMs.toFixed(1)}ms | ${r.p50.toFixed(1)}ms | ${r.p95.toFixed(1)}ms | ${r.explain} |`,
		);
	}

	const directStart = process.hrtime.bigint();
	await listViewerPages(accessor, { limit: 100 });
	const directMs = Number(process.hrtime.bigint() - directStart) / 1e6;
	console.log(
		`\nDirect \`listViewerPages\` call (no HTTP layer), default view: ${directMs.toFixed(1)}ms`,
	);
}

for (const n of SIZES) {
	console.log(
		`\n══════════ ${n.toLocaleString()} rows (seeded via Archive.setPage) ══════════`,
	);
	const seedStart = process.hrtime.bigint();
	const { accessor, dbFilePath, cleanupDir } = await makeDb(n);
	console.log(
		`  seed time: ${(Number(process.hrtime.bigint() - seedStart) / 1e6).toFixed(0)}ms`,
	);
	try {
		const seedSizeBytes = statSync(dbFilePath).size;
		console.log(`  seeded DB size: ${(seedSizeBytes / 1024 / 1024).toFixed(1)} MiB`);

		const { buildMs, sizeBeforeBytes, sizeAfterBytes } = await buildReadModel(
			accessor,
			dbFilePath,
		);
		const addedBytes = sizeAfterBytes - sizeBeforeBytes;
		console.log(`  read-model build time: ${buildMs.toFixed(0)}ms`);
		console.log(
			`  read-model added DB size: ${(addedBytes / 1024 / 1024).toFixed(1)} MiB`,
		);

		await runMatrix(accessor, n);
	} finally {
		// `releaseHandle()` (not `close()`): this bench never needs the
		// resulting `.nitpicker` tar, only the raw tmpDir's `db.sqlite` for
		// size stats above — `close()`'s implicit `write()` checkpoints the
		// WAL, which can collide with the just-run bench queries' own
		// connections still settling. `releaseHandle()` drops the handle with
		// no filesystem mutation.
		await accessor.releaseHandle();
		rmSync(cleanupDir, { recursive: true, force: true });
	}
}
console.log('\nDone.');
