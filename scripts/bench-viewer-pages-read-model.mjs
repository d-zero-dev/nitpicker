#!/usr/bin/env node
/**
 * Benchmarks `/api/pages`'s `viewer_pages` read-model fast path (issue
 * #106) on a synthetic archive with hundreds of thousands of content
 * records — no real customer archive is ever read or referenced.
 *
 * Records, per `docs/viewer-implementation-plan.md`'s Benchmark Contract:
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
 * USAGE
 * -----
 *
 *     yarn build && node scripts/bench-viewer-pages-read-model.mjs
 *
 * Sizes default to {400,000}; override via `BENCH_SIZES=…` (comma
 * separated). Always disk-backed (never `:memory:`) — the whole point is
 * measuring realistic cold-cache I/O, which an in-memory DB can't produce.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import knex from 'knex';

import { initSchema } from '../packages/@nitpicker/crawler/lib/archive/init-schema.js';
import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';
import { applyViewerPagesFilters } from '../packages/@nitpicker/query/lib/apply-viewer-pages-filters.js';
import { listViewerPages } from '../packages/@nitpicker/query/lib/list-viewer-pages.js';
import { getViewerPagesSortSpec } from '../packages/@nitpicker/query/lib/viewer-pages-cursor/get-viewer-pages-sort-spec.js';
import { buildViewerReadModel } from '../packages/@nitpicker/query/lib/viewer-read-model/build-viewer-read-model.js';
import { createApp } from '../packages/@nitpicker/viewer/lib/create-app.js';

const SIZES = process.env.BENCH_SIZES
	? process.env.BENCH_SIZES.split(',').map((s) => Number(s.trim()))
	: [400_000];

/** Repeated warm requests per matrix entry, for p50/p95. */
const WARM_ITERATIONS = 30;

/**
 * Filter/sort combinations benchmarked per
 * `docs/viewer-sql-query-plan.md`'s `/api/pages` "Supported fast filters"
 * list. `query` is the literal `/api/pages` query string; `options` is the
 * equivalent `ListViewerPagesOptions` used for the direct (non-HTTP)
 * function-level EXPLAIN construction.
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
 * Materialises a disk-backed synthetic archive DB with `n` `pages` rows
 * spanning every facet/filter dimension `/api/pages` supports — status mix
 * (200/301/404/500/null), a minority external / non-HTML / no-lang /
 * missing-title / missing-description / noindex / non-`crawled`-source
 * population, matching real-world skew (mostly-HTML, mostly-200,
 * mostly-internal).
 * @param {number} n - The number of rows to insert.
 * @returns {Promise<{db: import('knex').Knex, dbFilePath: string, cleanupDir: string}>}
 *   The seeded Knex instance and its backing file/dir (for size + cleanup).
 */
async function makeDb(n) {
	const cleanupDir = path.join(
		tmpdir(),
		`nitpicker-bench-viewer-pages-${n}-${process.pid}`,
	);
	rmSync(cleanupDir, { recursive: true, force: true });
	mkdirSync(cleanupDir, { recursive: true });
	const dbFilePath = path.join(cleanupDir, 'db.sqlite');

	const db = knex({
		client: LibsqlDialect,
		connection: { filename: dbFilePath },
		useNullAsDefault: true,
	});
	await initSchema(db);

	const STATUSES = [200, 200, 200, 200, 301, 404, 500, null];
	const CONTENT_TYPES = [
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'text/html',
		'application/pdf',
		null,
	];
	const LANGS = ['ja', 'en', null];
	const SOURCES = [
		'crawled',
		'crawled',
		'crawled',
		'crawled',
		'crawled',
		'crawled',
		'crawled',
		'crawled',
		'crawled',
		'inventory-seed',
		'inventory-discovered',
	];

	// libsql tops out around a few hundred bound values per multi-row
	// INSERT before erroring on parameter count — 100 keeps this well
	// under that while still amortising round-trips (matches
	// bench-list-pages.mjs's CHUNK convention).
	const CHUNK = 100;
	const rows = [];
	for (let i = 0; i < n; i++) {
		const padded = String(i).padStart(8, '0');
		rows.push({
			url: `https://example.com/page-${padded}`,
			scraped: 1,
			isTarget: 1,
			isExternal: i % 10 === 0 ? 1 : 0,
			isSkipped: 0,
			redirectDestId: null,
			status: STATUSES[i % STATUSES.length],
			statusText: 'OK',
			contentType: CONTENT_TYPES[i % CONTENT_TYPES.length],
			contentLength: 1000,
			lang: LANGS[i % LANGS.length],
			title: i % 20 === 0 ? null : `Page ${padded}`,
			description: i % 7 === 0 ? null : `Synthetic page ${padded} for bench`,
			og_title: `OG Page ${padded}`,
			robots_noindex: i % 15 === 0 ? 1 : 0,
			source: SOURCES[i % SOURCES.length],
			tag_count: 0,
			jsonld_count: 0,
		});
		if (rows.length >= CHUNK) {
			await db('pages').insert(rows);
			rows.length = 0;
		}
	}
	if (rows.length > 0) {
		await db('pages').insert(rows);
	}
	return { db, dbFilePath, cleanupDir };
}

/**
 * Builds the viewer read model against the seeded DB, timing the build and
 * measuring the DB file's size delta.
 * @param {import('knex').Knex} db - The seeded Knex instance.
 * @param {string} dbFilePath - The DB's backing file path (for `statSync`).
 * @returns {Promise<{buildMs: number, sizeBeforeBytes: number, sizeAfterBytes: number, facetBucketCount: number}>}
 *   Build timing and size metrics.
 */
async function buildReadModel(db, dbFilePath) {
	const sizeBeforeBytes = statSync(dbFilePath).size;
	// `buildViewerReadModel` only calls `.readOnly` and `.getKnex()` on its
	// accessor — a plain stub satisfies both, same convention as
	// bench-list-pages.mjs's `accessorStub`.
	const accessorStub = { readOnly: false, getKnex: () => db };
	const start = process.hrtime.bigint();
	await buildViewerReadModel(accessorStub);
	const buildMs = Number(process.hrtime.bigint() - start) / 1e6;
	const sizeAfterBytes = statSync(dbFilePath).size;

	const facetBucketCount = await db('viewer_count_buckets')
		.where('key', 'like', 'facet:%')
		.count('* as count');

	return {
		buildMs,
		sizeBeforeBytes,
		sizeAfterBytes,
		facetBucketCount: Number(facetBucketCount[0]?.count ?? 0),
	};
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
 * @param {import('knex').Knex} db - The Knex instance with a built read model.
 * @param {number} n - The row count this DB was seeded with (for the report header).
 */
async function runMatrix(db, n) {
	const accessorStub = { getKnex: () => db };
	const app = createApp({
		context: { archiveId: 'bench', manager: { get: () => accessorStub } },
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

	// Print the raw EXPLAIN QUERY PLAN text rather than a SCAN/SEARCH
	// heuristic verdict: SQLite reports a full ordered index scan as
	// "SCAN viewer_pages USING COVERING INDEX vp_…", which contains the
	// substring "SCAN viewer_pages" despite still using the index — a naive
	// regex would misclassify it as a bad table scan. Read the plan text
	// directly; a genuinely bad plan has no "USING … INDEX" at all, or adds
	// "USE TEMP B-TREE FOR ORDER BY" (an extra sort the index should have
	// avoided).
	console.log('\n  filter/sort                       cold      p50      p95');
	for (const r of results) {
		console.log(
			`  ${r.label.padEnd(32)} ${`${r.coldMs.toFixed(1)}ms`.padStart(8)} ${`${r.p50.toFixed(1)}ms`.padStart(8)} ${`${r.p95.toFixed(1)}ms`.padStart(8)}`,
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

	// listViewerPages function-level sanity check — confirms the HTTP numbers
	// above aren't dominated by Hono/JSON overhead alone.
	const directStart = process.hrtime.bigint();
	await listViewerPages(accessorStub, { limit: 100 });
	const directMs = Number(process.hrtime.bigint() - directStart) / 1e6;
	console.log(
		`\nDirect \`listViewerPages\` call (no HTTP layer), default view: ${directMs.toFixed(1)}ms`,
	);
}

for (const n of SIZES) {
	console.log(`\n══════════ ${n.toLocaleString()} rows ══════════`);
	const { db, dbFilePath, cleanupDir } = await makeDb(n);
	try {
		const seedSizeBytes = statSync(dbFilePath).size;
		console.log(`  seeded DB size: ${(seedSizeBytes / 1024 / 1024).toFixed(1)} MiB`);

		const { buildMs, sizeBeforeBytes, sizeAfterBytes, facetBucketCount } =
			await buildReadModel(db, dbFilePath);
		const addedBytes = sizeAfterBytes - sizeBeforeBytes;
		console.log(`  read-model build time: ${buildMs.toFixed(0)}ms`);
		console.log(
			`  read-model added DB size: ${(addedBytes / 1024 / 1024).toFixed(1)} MiB (of which ${facetBucketCount.toLocaleString()} facet bucket rows)`,
		);

		await runMatrix(db, n);
	} finally {
		await db.destroy();
		rmSync(cleanupDir, { recursive: true, force: true });
	}
}
console.log('\nDone.');
