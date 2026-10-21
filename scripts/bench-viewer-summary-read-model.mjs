#!/usr/bin/env node
/**
 * Benchmarks `/api/summary`'s `viewer_summary` read-model fast path on a
 * synthetic archive with tens of thousands of content records — no real
 * customer archive is ever read or referenced. The archive is seeded through
 * the real write path (`Archive.setPage`, as a live crawl writes it), because
 * a fresh archive has no `pages` table to insert into: the writer uses the
 * `content_items` / `page_meta` entity tables, which is also what
 * `buildViewerReadModel` reads.
 *
 * Records:
 *
 *   - row count / read-model build time / added DB size
 *   - `getSummary` (legacy, before) vs `getViewerSummary` (read-model, after)
 *     direct function-level cold timing — isolates what the read model
 *     itself buys, independent of the viewer process's own LRU/on-disk
 *     cache (`summary-cache.ts`), which already flattens repeat requests
 *     regardless of which backend answered the first one.
 *   - `/api/summary` cold/warm p50/p95 through the real Hono app, once
 *     before and once after the read model exists — each measured against
 *     its own fresh `archiveId` so the viewer-process LRU is empty for both
 *     "cold" measurements (a shared LRU would otherwise make every "after"
 *     request as fast as "before"'s cache hit, hiding the read model's
 *     actual contribution).
 *   - `EXPLAIN QUERY PLAN` for the `viewer_summary` read
 *
 * "Cold" here means "SQLite page cache empty for this DB file" and/or "no
 * viewer-process LRU entry yet", not an OS page-cache flush — the same
 * convention this repo's other perf notes use (see CLAUDE.md's `getSummary`
 * cache note). "Warm" means the viewer-process LRU already holds an entry
 * for that `archiveId`.
 *
 * USAGE
 * -----
 *
 *     yarn build && node scripts/bench-viewer-summary-read-model.mjs
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
import Archive from '@nitpicker/archive/archive';

import { getSummary } from '../packages/@nitpicker/query/lib/get-summary.js';
import { getViewerSummary } from '../packages/@nitpicker/query/lib/get-viewer-summary.js';
import { buildViewerReadModel } from '../packages/@nitpicker/query/lib/viewer-read-model/build-viewer-read-model.js';
import { createApp } from '../packages/@nitpicker/viewer/lib/create-app.js';

const SIZES = process.env.BENCH_SIZES
	? process.env.BENCH_SIZES.split(',').map((s) => Number(s.trim()))
	: [50_000];

/** Repeated warm requests per phase, for p50/p95. */
const WARM_ITERATIONS = 30;

/** Fixed config payload every seeded archive reports via `accessor.getConfig()`. */
const CONFIG = { baseUrl: 'https://example.com', roots: ['https://example.com'] };

/**
 * Materialises a disk-backed synthetic archive with `n` pages, seeded through
 * `Archive.setPage`, spanning the dimensions `getSummary` aggregates over —
 * status mix (200/301/404/500/null), a minority external / non-HTML
 * population, matching real-world skew (mostly-HTML, mostly-200,
 * mostly-internal).
 * @param {number} n - The number of pages to seed.
 * @returns {Promise<{archive: import('@nitpicker/archive/archive').default, db: import('knex').Knex, dbFilePath: string, cleanupDir: string}>}
 *   The seeded, still-open archive, its Knex instance, and its backing file/dir (for size + cleanup).
 */
async function makeDb(n) {
	const cleanupDir = path.join(
		tmpdir(),
		`nitpicker-bench-viewer-summary-${n}-${process.pid}`,
	);
	rmSync(cleanupDir, { recursive: true, force: true });
	mkdirSync(cleanupDir, { recursive: true });

	const archive = await Archive.create({
		filePath: path.join(cleanupDir, 'archive.nitpicker'),
		cwd: cleanupDir,
	});
	await archive.setConfig({
		baseUrl: 'https://example.com',
		name: 'bench-viewer-summary',
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

	for (let i = 0; i < n; i++) {
		const padded = String(i).padStart(8, '0');
		const status = STATUSES[i % STATUSES.length];
		await archive.setPage({
			url: parseUrl(`https://example.com/page-${padded}`),
			redirectPaths: [],
			isExternal: i % 10 === 0,
			isTarget: true,
			status,
			statusText: status ? 'OK' : '',
			contentType: CONTENT_TYPES[i % CONTENT_TYPES.length],
			contentLength: 1000,
			responseHeaders: {},
			html: `<html><head><title>Page ${padded}</title></head><body>Page ${padded}</body></html>`,
			mainContents: null,
			scrollHeight: null,
			meta: {
				lang: null,
				title: i % 20 === 0 ? null : `Page ${padded}`,
				description: i % 7 === 0 ? null : `Synthetic page ${padded} for bench`,
				keywords: null,
				noindex: false,
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
		});
	}

	// `Archive.create`'s working directory is `<cwd>/._nitpicker-<basename>`.
	const dbFilePath = path.join(cleanupDir, '._nitpicker-archive', 'db.sqlite');
	return { archive, db: archive.getKnex(), dbFilePath, cleanupDir };
}

/**
 * Builds a minimal accessor stub satisfying the surface `getSummary` /
 * `getViewerSummary` / `buildViewerReadModel` need: `readOnly`, `getKnex()`,
 * `getConfig()`, and `tmpDir` (for the viewer's on-disk precomputed cache).
 * @param {import('knex').Knex} db - The seeded/built Knex instance.
 * @param {string} cleanupDir - The archive's backing directory, reused as
 *   `tmpDir` so `getOrComputeOnDisk` has somewhere real to write.
 * @returns {object} An `ArchiveAccessor`-shaped stub.
 */
function makeAccessorStub(db, cleanupDir) {
	return {
		readOnly: false,
		getKnex: () => db,
		getConfig: async () => CONFIG,
		tmpDir: cleanupDir,
	};
}

/**
 * Times `iterations` sequential HTTP round-trips through the real Hono app
 * for `/api/summary`, returning p50/p95 in milliseconds.
 * @param {import('hono').Hono} app - The app under test.
 * @param {number} iterations - Number of warm requests to time.
 * @returns {Promise<{p50: number, p95: number}>} Warm latency percentiles.
 */
async function timeWarmRequests(app, iterations) {
	const timings = [];
	for (let i = 0; i < iterations; i++) {
		const start = process.hrtime.bigint();
		const res = await app.request('/api/summary');
		await res.text();
		timings.push(Number(process.hrtime.bigint() - start) / 1e6);
	}
	timings.sort((a, b) => a - b);
	const p50 = timings[Math.floor(timings.length * 0.5)];
	const p95 = timings[Math.floor(timings.length * 0.95)];
	return { p50, p95 };
}

/**
 * Builds a Hono app wired to one `archiveId` mapped to the given accessor —
 * a fresh `archiveId` per phase keeps the viewer-process LRU (keyed by
 * `archiveId`) empty going into the "cold" measurement for that phase.
 * @param {object} accessorStub - The accessor to serve.
 * @param {string} archiveId - Unique id for this phase's LRU entry.
 * @returns {import('hono').Hono} The configured app.
 */
function makeApp(accessorStub, archiveId) {
	return createApp({
		context: {
			archiveId,
			manager: { get: () => accessorStub },
			mode: 'archive',
		},
		publicDir: '/tmp/no-such-dir-bench',
	});
}

/**
 * Runs one `/api/summary` phase (cold + warm HTTP timing) and prints a
 * results line.
 * @param {string} label - Phase label ("legacy" or "read-model").
 * @param {object} accessorStub - The accessor to serve.
 * @returns {Promise<{coldMs: number, p50: number, p95: number}>} Timing results.
 */
async function runHttpPhase(label, accessorStub) {
	const app = makeApp(accessorStub, `bench-${label}`);
	const coldStart = process.hrtime.bigint();
	const coldRes = await app.request('/api/summary');
	await coldRes.text();
	const coldMs = Number(process.hrtime.bigint() - coldStart) / 1e6;
	const { p50, p95 } = await timeWarmRequests(app, WARM_ITERATIONS);
	console.log(
		`  /api/summary (${label.padEnd(10)}) cold: ${coldMs.toFixed(1)}ms  warm p50: ${p50.toFixed(1)}ms  warm p95: ${p95.toFixed(1)}ms`,
	);
	return { coldMs, p50, p95 };
}

for (const n of SIZES) {
	console.log(`\n══════════ ${n.toLocaleString()} rows ══════════`);
	const { archive, db, dbFilePath, cleanupDir } = await makeDb(n);
	try {
		const seedSizeBytes = statSync(dbFilePath).size;
		console.log(`  seeded DB size: ${(seedSizeBytes / 1024 / 1024).toFixed(1)} MiB`);

		const accessorStub = makeAccessorStub(db, cleanupDir);

		// BEFORE: direct getSummary() call — the legacy full aggregation,
		// no read model built yet.
		const legacyStart = process.hrtime.bigint();
		const legacySummary = await getSummary(accessorStub);
		const legacyDirectMs = Number(process.hrtime.bigint() - legacyStart) / 1e6;
		console.log(
			`  direct getSummary() (legacy, no read model): ${legacyDirectMs.toFixed(1)}ms`,
		);

		const legacyHttp = await runHttpPhase('legacy', accessorStub);

		// The legacy HTTP phase just persisted a `getOrComputeOnDisk` artefact
		// under `<cleanupDir>/precomputed/summary.json`. Its cache key is
		// `tmpDir` + name, not `archiveId` — reused as-is by the read-model
		// phase below despite that phase's fresh `archiveId`, it would replay
		// the legacy-computed value instead of exercising `getViewerSummary`.
		// Clearing it here keeps the two HTTP phases independent.
		rmSync(path.join(cleanupDir, 'precomputed'), { recursive: true, force: true });

		// Build the read model.
		const sizeBeforeBytes = statSync(dbFilePath).size;
		const buildStart = process.hrtime.bigint();
		await buildViewerReadModel(accessorStub);
		const buildMs = Number(process.hrtime.bigint() - buildStart) / 1e6;
		const sizeAfterBytes = statSync(dbFilePath).size;
		console.log(`  read-model build time: ${buildMs.toFixed(0)}ms`);
		console.log(
			`  read-model added DB size: ${((sizeAfterBytes - sizeBeforeBytes) / 1024 / 1024).toFixed(1)} MiB`,
		);

		// AFTER: direct getViewerSummary() call — the viewer_summary fast path.
		const fastStart = process.hrtime.bigint();
		const fastSummary = await getViewerSummary(accessorStub);
		const fastDirectMs = Number(process.hrtime.bigint() - fastStart) / 1e6;
		console.log(`  direct getViewerSummary() (read model): ${fastDirectMs.toFixed(1)}ms`);

		const readModelHttp = await runHttpPhase('read-model', accessorStub);

		const plan = await db.raw(
			'EXPLAIN QUERY PLAN select * from viewer_summary where id = 1',
		);
		const explain = plan.map((row) => row.detail).join(' | ');
		console.log(`  EXPLAIN: ${explain}`);

		// Sanity check — both backends must agree on the numbers (aside from
		// `errorKindBreakdown` ordering, which JSON round-trips faithfully).
		if (JSON.stringify(legacySummary) !== JSON.stringify(fastSummary)) {
			throw new Error(
				'legacy getSummary() and getViewerSummary() disagree — investigate before trusting the timings above',
			);
		}

		console.log(
			'\n### Markdown summary (paste into PR/ARCHITECTURE.md, no archive-identifying details)\n',
		);
		console.log(
			`\`${n.toLocaleString()} synthetic rows\` — /api/summary viewer_summary fast path:\n`,
		);
		console.log('| phase | direct call | HTTP cold | HTTP warm p50 | HTTP warm p95 |');
		console.log('| --- | --- | --- | --- | --- |');
		console.log(
			`| legacy (before) | ${legacyDirectMs.toFixed(1)}ms | ${legacyHttp.coldMs.toFixed(1)}ms | ${legacyHttp.p50.toFixed(1)}ms | ${legacyHttp.p95.toFixed(1)}ms |`,
		);
		console.log(
			`| read model (after) | ${fastDirectMs.toFixed(1)}ms | ${readModelHttp.coldMs.toFixed(1)}ms | ${readModelHttp.p50.toFixed(1)}ms | ${readModelHttp.p95.toFixed(1)}ms |`,
		);
		console.log(`\nread-model build time: ${buildMs.toFixed(0)}ms`);
		console.log(`EXPLAIN QUERY PLAN: ${explain}`);
		console.log(
			'\nNote: HTTP "warm" numbers are dominated by the viewer-process LRU (`summary-cache.ts`), which caches the result after the first hit regardless of backend — the "direct call" and "HTTP cold" rows are what actually isolate the read model\'s contribution.',
		);
	} finally {
		await archive.releaseHandle();
		rmSync(cleanupDir, { recursive: true, force: true });
	}
}
console.log('\nDone.');
