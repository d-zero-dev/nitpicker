#!/usr/bin/env node
/**
 * Benchmarks `/api/error-kinds`'s `viewer_error_kind_*` read-model fast path
 * (issue #118) on a synthetic archive with hundreds of thousands of
 * `crawl_errors` rows — no real customer archive is ever read or
 * referenced.
 *
 * Records, mirroring `bench-viewer-summary-read-model.mjs`'s Benchmark
 * Contract:
 *
 *   - row count / read-model build time / added DB size
 *   - `getErrorKinds` (legacy, before) vs `getViewerErrorKinds` (read-model,
 *     after) direct function-level cold timing — isolates what the read
 *     model itself buys, independent of the viewer process's own
 *     LRU/on-disk cache (`error-kinds-cache.ts`), which already flattens
 *     repeat requests regardless of which backend answered the first one.
 *   - `/api/error-kinds` cold/warm p50/p95 through the real Hono app, once
 *     before and once after the read model exists — each measured against
 *     its own fresh `archiveId` so the viewer-process LRU is empty for both
 *     "cold" measurements.
 *   - `EXPLAIN QUERY PLAN` for the three `viewer_error_kind_*` reads
 *
 * "Cold" / "warm" follow the same convention as the summary bench script.
 *
 * USAGE
 * -----
 *
 *     yarn build && node scripts/bench-viewer-error-kinds-read-model.mjs
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
import { getErrorKinds } from '../packages/@nitpicker/query/lib/get-error-kinds.js';
import { getViewerErrorKinds } from '../packages/@nitpicker/query/lib/get-viewer-error-kinds.js';
import { buildViewerReadModel } from '../packages/@nitpicker/query/lib/viewer-read-model/build-viewer-read-model.js';
import { createApp } from '../packages/@nitpicker/viewer/lib/create-app.js';

const SIZES = process.env.BENCH_SIZES
	? process.env.BENCH_SIZES.split(',').map((s) => Number(s.trim()))
	: [400_000];

/** Repeated warm requests per phase, for p50/p95. */
const WARM_ITERATIONS = 30;

/** Fixed config payload every seeded archive reports via `accessor.getConfig()`. */
const CONFIG = { baseUrl: 'https://example.com', roots: ['https://example.com'] };

/**
 * Message templates that `classifyErrorKind` resolves to a stable kind,
 * weighted so the resulting per-kind totals are pairwise distinct (avoids a
 * tie-break-order-dependent sanity check between the legacy and read-model
 * results — see `get-viewer-error-kinds.spec.ts` for why ties are otherwise
 * order-unstable across the two implementations).
 * @param {number} hostIndex - Distinguishes hosts within a kind's traffic.
 * @returns {{kind: string, message: string}} The templates for one weighted
 *   sampling round (5 dns : 3 timeout : 2 connection-refused : 1 tls).
 */
function weightedTemplates(hostIndex) {
	return [
		{ kind: 'dns', message: `getaddrinfo ENOTFOUND host-${hostIndex}.example.net` },
		{ kind: 'dns', message: `getaddrinfo ENOTFOUND host-${hostIndex}.example.net` },
		{ kind: 'dns', message: `getaddrinfo ENOTFOUND host-${hostIndex}.example.net` },
		{ kind: 'dns', message: `getaddrinfo ENOTFOUND host-${hostIndex}.example.net` },
		{ kind: 'dns', message: `getaddrinfo ENOTFOUND host-${hostIndex}.example.net` },
		{ kind: 'timeout', message: 'Navigation timeout of 30000 ms exceeded' },
		{ kind: 'timeout', message: 'Navigation timeout of 30000 ms exceeded' },
		{ kind: 'timeout', message: 'Navigation timeout of 30000 ms exceeded' },
		{ kind: 'connection-refused', message: 'connect ECONNREFUSED 10.0.0.1:443' },
		{ kind: 'connection-refused', message: 'connect ECONNREFUSED 10.0.0.1:443' },
		{ kind: 'tls', message: 'ERR_CERT_AUTHORITY_INVALID' },
	];
}

/**
 * Materialises a disk-backed synthetic archive DB with `n` `crawl_errors`
 * rows spanning the dimensions `getErrorKinds` classifies over — a skewed
 * kind mix (mostly DNS, matching real-world failure distributions) across
 * a moderate number of distinct hosts.
 * @param {number} n - The number of rows to insert.
 * @returns {Promise<{db: import('knex').Knex, dbFilePath: string, cleanupDir: string}>}
 *   The seeded Knex instance and its backing file/dir (for size + cleanup).
 */
async function makeDb(n) {
	const cleanupDir = path.join(
		tmpdir(),
		`nitpicker-bench-viewer-error-kinds-${n}-${process.pid}`,
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

	const HOST_COUNT = 50;
	// libsql tops out around a few hundred bound values per multi-row
	// INSERT before erroring on parameter count (same convention as
	// bench-viewer-summary-read-model.mjs).
	const CHUNK = 200;
	const rows = [];
	for (let i = 0; i < n; i++) {
		const hostIndex = i % HOST_COUNT;
		const templates = weightedTemplates(hostIndex);
		const template = templates[i % templates.length];
		rows.push({
			url: `https://host-${hostIndex}.example.net/path-${i}`,
			isExternal: 1,
			message: template.message,
			createdAt: Date.now(),
		});
		if (rows.length >= CHUNK) {
			await db('crawl_errors').insert(rows);
			rows.length = 0;
		}
	}
	if (rows.length > 0) {
		await db('crawl_errors').insert(rows);
	}
	return { db, dbFilePath, cleanupDir };
}

/**
 * Builds a minimal accessor stub satisfying the surface `getErrorKinds` /
 * `getViewerErrorKinds` / `buildViewerReadModel` need: `readOnly`,
 * `getKnex()`, `getConfig()`, and `tmpDir` (for the viewer's on-disk
 * precomputed cache).
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
 * for `/api/error-kinds`, returning p50/p95 in milliseconds.
 * @param {import('hono').Hono} app - The app under test.
 * @param {number} iterations - Number of warm requests to time.
 * @returns {Promise<{p50: number, p95: number}>} Warm latency percentiles.
 */
async function timeWarmRequests(app, iterations) {
	const timings = [];
	for (let i = 0; i < iterations; i++) {
		const start = process.hrtime.bigint();
		const res = await app.request('/api/error-kinds');
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
 * Runs one `/api/error-kinds` phase (cold + warm HTTP timing) and prints a
 * results line.
 * @param {string} label - Phase label ("legacy" or "read-model").
 * @param {object} accessorStub - The accessor to serve.
 * @returns {Promise<{coldMs: number, p50: number, p95: number}>} Timing results.
 */
async function runHttpPhase(label, accessorStub) {
	const app = makeApp(accessorStub, `bench-${label}`);
	const coldStart = process.hrtime.bigint();
	const coldRes = await app.request('/api/error-kinds');
	await coldRes.text();
	const coldMs = Number(process.hrtime.bigint() - coldStart) / 1e6;
	const { p50, p95 } = await timeWarmRequests(app, WARM_ITERATIONS);
	console.log(
		`  /api/error-kinds (${label.padEnd(10)}) cold: ${coldMs.toFixed(1)}ms  warm p50: ${p50.toFixed(1)}ms  warm p95: ${p95.toFixed(1)}ms`,
	);
	return { coldMs, p50, p95 };
}

/**
 * Canonicalises an `ErrorKindsResult` for the cross-backend sanity check —
 * only `{kind, count}` pairs sorted by kind, since sub-array (hosts/samples)
 * order under tied counts is not a documented contract either backend
 * promises to agree on bit-for-bit.
 * @param {import('@nitpicker/query').ErrorKindsResult} result - The result to canonicalise.
 * @returns {{total: number, channelSource: string, counts: {kind: string, count: number}[]}}
 *   The canonical comparable shape.
 */
function canonicalize(result) {
	return {
		total: result.total,
		channelSource: result.channelSource,
		counts: result.groups
			.map((g) => ({ kind: g.kind, count: g.count }))
			.toSorted((a, b) => a.kind.localeCompare(b.kind)),
	};
}

for (const n of SIZES) {
	console.log(`\n══════════ ${n.toLocaleString()} rows ══════════`);
	const { db, dbFilePath, cleanupDir } = await makeDb(n);
	try {
		const seedSizeBytes = statSync(dbFilePath).size;
		console.log(`  seeded DB size: ${(seedSizeBytes / 1024 / 1024).toFixed(1)} MiB`);

		const accessorStub = makeAccessorStub(db, cleanupDir);

		// BEFORE: direct getErrorKinds() call — the legacy classify-and-aggregate
		// pass, no read model built yet.
		const legacyStart = process.hrtime.bigint();
		const legacyResult = await getErrorKinds(accessorStub);
		const legacyDirectMs = Number(process.hrtime.bigint() - legacyStart) / 1e6;
		console.log(
			`  direct getErrorKinds() (legacy, no read model): ${legacyDirectMs.toFixed(1)}ms`,
		);

		const legacyHttp = await runHttpPhase('legacy', accessorStub);

		// The legacy HTTP phase just persisted a `getOrComputeOnDisk` artefact
		// under `<cleanupDir>/precomputed/error-kinds.json`, keyed by `tmpDir` +
		// name (not `archiveId`) — clear it so the read-model phase below
		// actually exercises `getViewerErrorKinds` instead of replaying this.
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

		// AFTER: direct getViewerErrorKinds() call — the viewer_error_kind_*
		// fast path.
		const fastStart = process.hrtime.bigint();
		const fastResult = await getViewerErrorKinds(accessorStub);
		const fastDirectMs = Number(process.hrtime.bigint() - fastStart) / 1e6;
		console.log(
			`  direct getViewerErrorKinds() (read model): ${fastDirectMs.toFixed(1)}ms`,
		);

		const readModelHttp = await runHttpPhase('read-model', accessorStub);

		const groupsPlan = await db.raw(
			'EXPLAIN QUERY PLAN select kind, count from viewer_error_kind_groups order by count desc',
		);
		const hostsPlan = await db.raw(
			'EXPLAIN QUERY PLAN select kind, host, count from viewer_error_kind_hosts order by kind, count desc',
		);
		const samplesPlan = await db.raw(
			"EXPLAIN QUERY PLAN select kind, url from viewer_error_kind_samples where kind = 'dns' order by rank",
		);
		const explain = [
			`groups: ${groupsPlan.map((row) => row.detail).join(' | ')}`,
			`hosts: ${hostsPlan.map((row) => row.detail).join(' | ')}`,
			`samples: ${samplesPlan.map((row) => row.detail).join(' | ')}`,
		].join('\n           ');
		console.log(`  EXPLAIN:\n           ${explain}`);

		// Sanity check — both backends must agree on the classification/counts.
		// Sub-array (hosts/samples) order under tied counts is intentionally
		// excluded — see `canonicalize`'s docs.
		const legacyCanonical = canonicalize(legacyResult);
		const fastCanonical = canonicalize(fastResult);
		if (JSON.stringify(legacyCanonical) !== JSON.stringify(fastCanonical)) {
			throw new Error(
				'legacy getErrorKinds() and getViewerErrorKinds() disagree on {kind, count} — investigate before trusting the timings above',
			);
		}

		console.log(
			'\n### Markdown summary (paste into PR/ARCHITECTURE.md, no archive-identifying details)\n',
		);
		console.log(
			`\`${n.toLocaleString()} synthetic rows\` — /api/error-kinds viewer_error_kind_* fast path:\n`,
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
		console.log(
			'\nNote: HTTP "warm" numbers are dominated by the viewer-process LRU (`error-kinds-cache.ts`), which caches the result after the first hit regardless of backend — the "direct call" and "HTTP cold" rows are what actually isolate the read model\'s contribution.',
		);
	} finally {
		await db.destroy();
		rmSync(cleanupDir, { recursive: true, force: true });
	}
}
console.log('\nDone.');
