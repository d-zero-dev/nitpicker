#!/usr/bin/env node
/**
 * Benchmarks `/api/duplicates`'s and `/api/mismatches`'s
 * `viewer_duplicate_groups`/`viewer_duplicate_group_pages`/`viewer_mismatches`
 * read-model fast path (issue #115) on a synthetic archive — no real
 * customer archive is ever read or referenced, every URL uses the
 * `example.com`/`example.net` placeholder domains.
 *
 * Records, mirroring `bench-viewer-resources-read-model.mjs`'s Benchmark
 * Contract:
 *
 *   - row count / read-model build time / added DB size
 *   - `findDuplicates`/`findMismatches` (legacy, before) vs
 *     `getDuplicatesFastPath`/`getMismatchesFastPath` (read-model, after)
 *     direct function-level cold timing, for the default (unfiltered) shape
 *   - `/api/duplicates` and `/api/mismatches` cold HTTP timing through the
 *     real Hono app, once before and once after the read model exists
 *   - warm (repeated-request) p50/p95 timing and `EXPLAIN QUERY PLAN` for a
 *     filter/sort MATRIX run against `/api/mismatches` once the read model
 *     exists — including the explicit `sortBy: 'url'` (natural-URL-order,
 *     `natural_url_rank`) / `sortBy: 'actual'` sorts and the `urlPattern`
 *     filter, none of which force a live fallback (see
 *     `getMismatchesFastPath`'s docs)
 *   - `EXPLAIN QUERY PLAN` for the default read shapes of
 *     `viewer_duplicate_groups`/`viewer_duplicate_group_pages`
 *
 * Seeds through the real write path (`Archive.setPage`, same as a live
 * crawl) rather than raw `INSERT`s against a hand-picked table shape — the
 * writer moved to the 0.13 `content_items`/`page_meta` entity tables (issue
 * #196, 2026-07-16) and there is no `pages` table in a fresh archive to seed
 * directly. `page.meta` is built in beholder's current NESTED shape
 * (`meta.link.canonical`, `meta.og.title`, NOT the flat `meta.canonical`/
 * `meta['og:title']` a pre-0.13 caller could get away with) — `insertPage`'s
 * `deriveFlatFromMeta` reads exactly those nested paths, so a flat literal
 * would silently seed every duplicate/mismatch column `null` and this bench
 * would spend its entire matrix measuring empty result sets.
 *
 * USAGE
 * -----
 *
 *     yarn build && node scripts/bench-viewer-duplicates-mismatches-read-model.mjs
 *
 * Sizes default to {20,000}; override via `BENCH_SIZES=…` (comma
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

import { findDuplicates } from '../packages/@nitpicker/query/lib/find-duplicates.js';
import { findMismatches } from '../packages/@nitpicker/query/lib/find-mismatches.js';
import { getDuplicatesFastPath } from '../packages/@nitpicker/query/lib/get-duplicates-fast-path.js';
import { getMismatchesFastPath } from '../packages/@nitpicker/query/lib/get-mismatches-fast-path.js';
import { getMismatchesSortSpec } from '../packages/@nitpicker/query/lib/viewer-mismatches-cursor/get-mismatches-sort-spec.js';
import { buildViewerReadModel } from '../packages/@nitpicker/query/lib/viewer-read-model/build-viewer-read-model.js';
import { createApp } from '../packages/@nitpicker/viewer/lib/create-app.js';

const SIZES = process.env.BENCH_SIZES
	? process.env.BENCH_SIZES.split(',').map((s) => Number(s.trim()))
	: [20_000];

/** Repeated warm requests per matrix entry, for p50/p95. */
const WARM_ITERATIONS = 20;

/** Members per duplicate-title / duplicate-description group. */
const GROUP_SIZE = 10;

/**
 * Filter/sort combinations benchmarked against `/api/mismatches?type=canonical`
 * — the pre-existing default (unsorted, `url_sort_key` BINARY order) shape
 * plus every filter/sort the `viewer_mismatches` fast path serves: the
 * explicit `sortBy: 'url'` natural-URL-order sort (`natural_url_rank`,
 * distinct from the default's BINARY `url_sort_key` order), `sortBy: 'actual'`,
 * and the LIKE-based `urlPattern` (see `getMismatchesFastPath`'s docs — none
 * of these force a live fallback once the read model is current).
 */
const MISMATCHES_MATRIX = [
	{
		label: 'default (url binary)',
		query: 'type=canonical&limit=100',
		options: { type: 'canonical' },
	},
	{
		label: 'sort=url (natural)',
		query: 'type=canonical&sortBy=url&limit=100',
		options: { type: 'canonical', sortBy: 'url' },
	},
	{
		label: 'sort=actual',
		query: 'type=canonical&sortBy=actual&limit=100',
		options: { type: 'canonical', sortBy: 'actual' },
	},
	{
		label: 'urlPattern=%25page-1%25',
		query: 'type=canonical&urlPattern=%25page-1%25&limit=100',
		options: { type: 'canonical', urlPattern: '%page-1%' },
	},
];

/**
 * Materialises a disk-backed synthetic archive seeded through the real
 * write path (`Archive.setPage`), spanning every facet `/api/duplicates`/
 * `/api/mismatches` support:
 *
 *   - ~1/GROUP_SIZE distinct `title` values, each shared by `GROUP_SIZE`
 *     pages (every title value is a duplicate group)
 *   - ~1/GROUP_SIZE distinct `description` values, same pattern, offset so
 *     the two dedupe axes don't trivially coincide
 *   - ~10% of pages with a `link.canonical` pointing at a different URL (a
 *     canonical mismatch)
 *   - ~10% of pages with an `og.title` different from `title` (an og:title
 *     mismatch); the remaining ~90% carry `og.title === title` (present, not
 *     a mismatch) rather than omitting `og` entirely, matching a real
 *     crawl's typical "OG tags mirror the title tag" population
 * @param {number} n - The number of pages to seed.
 * @returns {Promise<{accessor: import('@nitpicker/crawler').ArchiveAccessor, dbFilePath: string, cleanupDir: string}>}
 *   The seeded, still-open archive (for `getKnex()`) and its backing dir (for size + cleanup).
 */
async function makeDb(n) {
	const cleanupDir = path.join(
		tmpdir(),
		`nitpicker-bench-viewer-dup-mismatch-${n}-${process.pid}`,
	);
	const filePath = path.join(cleanupDir, 'archive.nitpicker');
	rmSync(cleanupDir, { recursive: true, force: true });
	mkdirSync(cleanupDir, { recursive: true });

	const archive = await Archive.create({ filePath, cwd: cleanupDir });
	await archive.setConfig({
		baseUrl: 'https://example.com',
		name: 'bench-viewer-dup-mismatch',
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

	for (let i = 0; i < n; i++) {
		const titleGroup = Math.floor(i / GROUP_SIZE);
		const descriptionGroup = Math.floor((i + Math.floor(GROUP_SIZE / 2)) / GROUP_SIZE);
		const hasCanonicalMismatch = i % 10 === 0;
		const hasOgTitleMismatch = i % 10 === 5;
		const title = `Duplicate Title #${titleGroup}`;
		const description = `Duplicate Description #${descriptionGroup}`;
		const url = `https://example.com/page-${i}`;

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
			html: `<html><head><title>${title}</title></head><body>Page ${i}</body></html>`,
			mainContents: null,
			scrollHeight: null,
			// NESTED Meta shape — see this file's top JSDoc for why a flat
			// `meta.canonical`/`meta['og:title']` literal would silently no-op
			// against `deriveFlatFromMeta`'s `meta.link?.canonical`/`meta.og?.title`
			// reads.
			meta: {
				title,
				description,
				link: hasCanonicalMismatch
					? { canonical: `https://example.com/canonical-target-${i}` }
					: undefined,
				og: { title: hasOgTitleMismatch ? `Different OG Title #${i}` : title },
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	}

	// `Archive.create`'s tmpDir is `<cwd>/._nitpicker-<basename-without-ext>`
	// (see `Archive.create`'s own `tmpDir` derivation) — same convention
	// `bench-viewer-pages-read-model.mjs`'s `makeDb` documents.
	const dbFilePath = path.join(cleanupDir, '._nitpicker-archive', 'db.sqlite');
	return { accessor: archive, dbFilePath, cleanupDir };
}

/**
 * Resolves `findMismatches`/`listViewerMismatches`'s `sortBy` → effective
 * sort mapping (unset → `'urlBinary'`, explicit `'url'` → `'urlNatural'`,
 * everything else passed through) — mirrors `list-viewer-mismatches.ts`'s
 * own `effectiveSortBy` derivation so this bench's EXPLAIN plan reflects the
 * exact column the production read uses.
 * @param {string | undefined} sortBy - The caller's raw `sortBy` option.
 * @returns {'urlBinary' | 'urlNatural' | 'actual' | 'expected'} The effective sort.
 */
function toEffectiveMismatchesSortBy(sortBy) {
	if (sortBy == null) {
		return 'urlBinary';
	}
	return sortBy === 'url' ? 'urlNatural' : sortBy;
}

/**
 * Runs `EXPLAIN QUERY PLAN` for one `MISMATCHES_MATRIX` entry's
 * id-resolution query against `viewer_mismatches`. Built as a raw SQL
 * string (not the production query builder — `listMismatches`'s own
 * `type`/`urlPattern` filtering lives as a non-exported local function
 * inside `list-viewer-mismatches.ts`) but reuses the exported
 * `getMismatchesSortSpec` so the `ORDER BY` columns stay accurate.
 * @param {import('knex').Knex} db - The Knex instance.
 * @param {{type: string, sortBy?: string, sortOrder?: string, urlPattern?: string}} options
 *   The matrix entry's filter/sort options.
 * @returns {Promise<string>} One `|`-joined line of `EXPLAIN QUERY PLAN` detail rows.
 */
async function explainMismatchesMatrixEntry(db, options) {
	const sortOrder = options.sortOrder ?? 'asc';
	const effectiveSortBy = toEffectiveMismatchesSortBy(options.sortBy);
	const spec = getMismatchesSortSpec(effectiveSortBy, sortOrder);
	const conditions = ['type = ?'];
	const bindings = [options.type];
	if (options.urlPattern) {
		conditions.push('url_sort_key like ?');
		bindings.push(options.urlPattern);
	}
	const selectColumns = [...new Set(['mismatch_id', ...spec.columns])];
	const orderSql = spec.columns
		.map((column) => `${column} ${spec.scanDirection}`)
		.join(', ');
	const sql = `EXPLAIN QUERY PLAN select ${selectColumns.join(', ')} from viewer_mismatches where ${conditions.join(' and ')} order by ${orderSql} limit 100`;
	const plan = await db.raw(sql, bindings);
	return plan.map((row) => row.detail).join(' | ');
}

/**
 * Times `iterations` sequential HTTP round-trips through the real Hono app
 * for one query string, returning p50/p95 in milliseconds.
 * @param {import('hono').Hono} app - The app under test.
 * @param {string} query - The `/api/mismatches` query string (no leading `?`).
 * @param {number} iterations - Number of warm requests to time.
 * @returns {Promise<{p50: number, p95: number}>} Warm latency percentiles.
 */
async function timeWarmRequests(app, query, iterations) {
	const timings = [];
	for (let i = 0; i < iterations; i++) {
		const start = process.hrtime.bigint();
		const res = await app.request(`/api/mismatches?${query}`);
		await res.text();
		timings.push(Number(process.hrtime.bigint() - start) / 1e6);
	}
	timings.sort((a, b) => a - b);
	const p50 = timings[Math.floor(timings.length * 0.5)];
	const p95 = timings[Math.floor(timings.length * 0.95)];
	return { p50, p95 };
}

/**
 * Runs `MISMATCHES_MATRIX` (EXPLAIN + cold/warm HTTP timing) against the
 * fast-path app once the read model is built, printing a results table and
 * a copy-pasteable Markdown summary block — same shape as
 * `bench-viewer-resources-read-model.mjs`'s `runResourcesMatrix`.
 * @param {import('knex').Knex} db - The archive's Knex instance.
 * @param {import('hono').Hono} fastApp - The Hono app wired to the
 *   read-model-backed accessor.
 */
async function runMismatchesMatrix(db, fastApp) {
	const results = [];
	for (const entry of MISMATCHES_MATRIX) {
		const explain = await explainMismatchesMatrixEntry(db, entry.options);
		const coldStart = process.hrtime.bigint();
		const coldRes = await fastApp.request(`/api/mismatches?${entry.query}`);
		await coldRes.text();
		const coldMs = Number(process.hrtime.bigint() - coldStart) / 1e6;
		const { p50, p95 } = await timeWarmRequests(fastApp, entry.query, WARM_ITERATIONS);
		results.push({ ...entry, coldMs, p50, p95, explain });
	}

	console.log('\n  /api/mismatches filter/sort                cold      p50      p95');
	for (const r of results) {
		console.log(
			`  ${r.label.padEnd(40)} ${`${r.coldMs.toFixed(1)}ms`.padStart(8)} ${`${r.p50.toFixed(1)}ms`.padStart(8)} ${`${r.p95.toFixed(1)}ms`.padStart(8)}`,
		);
		console.log(`      EXPLAIN: ${r.explain}`);
	}

	console.log(
		'\n### Markdown summary — /api/mismatches filter/sort matrix (paste into PR/ARCHITECTURE.md, no archive-identifying details)\n',
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
		`\n══════════ ${n.toLocaleString()} pages (seeded via Archive.setPage) ══════════`,
	);
	const seedStart = process.hrtime.bigint();
	const { accessor, dbFilePath, cleanupDir } = await makeDb(n);
	console.log(
		`  seed time: ${(Number(process.hrtime.bigint() - seedStart) / 1e6).toFixed(0)}ms`,
	);
	try {
		const seedSizeBytes = statSync(dbFilePath).size;
		console.log(`  seeded DB size: ${(seedSizeBytes / 1024 / 1024).toFixed(1)} MiB`);

		// BEFORE: legacy direct calls.
		const legacyDupStart = process.hrtime.bigint();
		const legacyDuplicates = await findDuplicates(accessor, 'title', 50);
		const legacyDupMs = Number(process.hrtime.bigint() - legacyDupStart) / 1e6;
		console.log(`  direct findDuplicates() (legacy): ${legacyDupMs.toFixed(1)}ms`);

		const legacyMismatchStart = process.hrtime.bigint();
		// Paged-mode (options-object) call so `.total` is directly comparable to
		// `getMismatchesFastPath`'s `.total` below — the positional-args overload
		// only ever returns a bare, limit-capped array with no total count.
		const legacyMismatches = await findMismatches(accessor, 'canonical', {
			limit: 100,
		});
		const legacyMismatchMs = Number(process.hrtime.bigint() - legacyMismatchStart) / 1e6;
		console.log(`  direct findMismatches() (legacy): ${legacyMismatchMs.toFixed(1)}ms`);

		const legacyApp = makeApp(accessor, 'bench-legacy');
		const legacyHttpDupStart = process.hrtime.bigint();
		const legacyDupRes = await legacyApp.request('/api/duplicates?field=title');
		await legacyDupRes.text();
		const legacyHttpDupMs = Number(process.hrtime.bigint() - legacyHttpDupStart) / 1e6;
		const legacyHttpMismatchStart = process.hrtime.bigint();
		const legacyMismatchRes = await legacyApp.request('/api/mismatches?type=canonical');
		await legacyMismatchRes.text();
		const legacyHttpMismatchMs =
			Number(process.hrtime.bigint() - legacyHttpMismatchStart) / 1e6;
		console.log(
			`  HTTP /api/duplicates (legacy): ${legacyHttpDupMs.toFixed(1)}ms  /api/mismatches: ${legacyHttpMismatchMs.toFixed(1)}ms`,
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

		// AFTER: read-model dispatch calls (getDuplicatesFastPath/getMismatchesFastPath
		// automatically prefer the read model once isViewerReadModelCurrent is true).
		const fastDupStart = process.hrtime.bigint();
		const fastDuplicates = await getDuplicatesFastPath(accessor, {
			field: 'title',
			limit: 50,
		});
		const fastDupMs = Number(process.hrtime.bigint() - fastDupStart) / 1e6;
		console.log(
			`  direct getDuplicatesFastPath() (read model): ${fastDupMs.toFixed(1)}ms`,
		);

		const fastMismatchStart = process.hrtime.bigint();
		const fastMismatches = await getMismatchesFastPath(accessor, 'canonical', {
			limit: 100,
		});
		const fastMismatchMs = Number(process.hrtime.bigint() - fastMismatchStart) / 1e6;
		console.log(
			`  direct getMismatchesFastPath() (read model): ${fastMismatchMs.toFixed(1)}ms`,
		);

		const fastApp = makeApp(accessor, 'bench-read-model');
		const fastHttpDupStart = process.hrtime.bigint();
		const fastDupRes = await fastApp.request('/api/duplicates?field=title');
		await fastDupRes.text();
		const fastHttpDupMs = Number(process.hrtime.bigint() - fastHttpDupStart) / 1e6;
		const fastHttpMismatchStart = process.hrtime.bigint();
		const fastMismatchRes = await fastApp.request('/api/mismatches?type=canonical');
		await fastMismatchRes.text();
		const fastHttpMismatchMs =
			Number(process.hrtime.bigint() - fastHttpMismatchStart) / 1e6;
		console.log(
			`  HTTP /api/duplicates (read model): ${fastHttpDupMs.toFixed(1)}ms  /api/mismatches: ${fastHttpMismatchMs.toFixed(1)}ms`,
		);

		const db = accessor.getKnex();
		const groupsPlan = await db.raw(
			'EXPLAIN QUERY PLAN select group_id from viewer_duplicate_groups where field = ? order by count_desc_key, group_id limit 50',
			['title'],
		);
		const groupPagesPlan = await db.raw(
			'EXPLAIN QUERY PLAN select url_sort_key from viewer_duplicate_group_pages where group_id = ? order by url_sort_key, page_id limit 20',
			[1],
		);
		console.log(
			`  EXPLAIN (viewer_duplicate_groups): ${groupsPlan.map((row) => row.detail).join(' | ')}`,
		);
		console.log(
			`  EXPLAIN (viewer_duplicate_group_pages): ${groupPagesPlan.map((row) => row.detail).join(' | ')}`,
		);

		// Sanity check — both backends must agree on totals.
		if (legacyDuplicates.length !== fastDuplicates.items.length) {
			throw new Error(
				`legacy findDuplicates() and getDuplicatesFastPath() disagree on group count: ${legacyDuplicates.length} vs ${fastDuplicates.items.length}`,
			);
		}
		if (legacyMismatches.total !== fastMismatches.total) {
			throw new Error(
				`legacy findMismatches() and getMismatchesFastPath() disagree on total: ${legacyMismatches.total} vs ${fastMismatches.total}`,
			);
		}
		if (legacyMismatches.total === 0) {
			throw new Error(
				'legacy findMismatches() found 0 canonical mismatches — the synthetic seed is not producing the expected ~10% canonical-mismatch population; check makeDb()’s meta.link.canonical seeding.',
			);
		}

		// Filter/sort matrix — including the sortBy:'url' (natural) /
		// sortBy:'actual' / urlPattern entries the `viewer_mismatches` fast
		// path serves.
		await runMismatchesMatrix(db, fastApp);

		console.log(
			'\n### Markdown summary — before/after (paste into PR/CLAUDE.md, no archive-identifying details)\n',
		);
		console.log(
			`\`${n.toLocaleString()} synthetic pages\` — viewer_duplicate_groups/viewer_duplicate_group_pages/viewer_mismatches fast path:\n`,
		);
		console.log('| endpoint | phase | direct call | HTTP |');
		console.log('| --- | --- | --- | --- |');
		console.log(
			`| /api/duplicates | legacy (before) | ${legacyDupMs.toFixed(1)}ms | ${legacyHttpDupMs.toFixed(1)}ms |`,
		);
		console.log(
			`| /api/duplicates | read model (after) | ${fastDupMs.toFixed(1)}ms | ${fastHttpDupMs.toFixed(1)}ms |`,
		);
		console.log(
			`| /api/mismatches | legacy (before) | ${legacyMismatchMs.toFixed(1)}ms | ${legacyHttpMismatchMs.toFixed(1)}ms |`,
		);
		console.log(
			`| /api/mismatches | read model (after) | ${fastMismatchMs.toFixed(1)}ms | ${fastHttpMismatchMs.toFixed(1)}ms |`,
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
