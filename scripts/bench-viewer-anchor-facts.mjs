#!/usr/bin/env node
/**
 * Benchmarks `/api/links?type=broken`'s `viewer_anchor_facts` read-model
 * fast path (issue #114) on a synthetic archive with hundreds of thousands
 * of anchor records — no real customer archive is ever read or referenced.
 *
 * Records:
 *
 *   - page/anchor row counts, read-model build time, added DB size
 *   - `/api/links?type=broken` cold (first request after the just-built
 *     DB) and warm p50/p95 timing, per sort combination
 *   - `EXPLAIN QUERY PLAN` for each combination's read query
 *
 * "Cold"/"warm" follow the same convention as
 * `bench-viewer-pages-read-model.mjs` and CLAUDE.md's `getSummary` cache
 * note.
 *
 * USAGE
 * -----
 *
 *     yarn build && node scripts/bench-viewer-anchor-facts.mjs
 *
 * Sizes (page counts) default to {50,000}; override via `BENCH_SIZES=…`
 * (comma separated). Each page gets a fixed anchor fan-out, so the anchor
 * (and viewer_anchor_facts) row count is roughly 8x the page count. Always
 * disk-backed (never `:memory:`) — the whole point is measuring realistic
 * cold-cache I/O, which an in-memory DB can't produce.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import knex from 'knex';

import { initSchema } from '../packages/@nitpicker/crawler/lib/archive/init-schema.js';
import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';
import { listViewerBrokenLinks } from '../packages/@nitpicker/query/lib/list-viewer-broken-links.js';
import { buildViewerReadModel } from '../packages/@nitpicker/query/lib/viewer-read-model/build-viewer-read-model.js';
import { createApp } from '../packages/@nitpicker/viewer/lib/create-app.js';

const SIZES = process.env.BENCH_SIZES
	? process.env.BENCH_SIZES.split(',').map((s) => Number(s.trim()))
	: [50_000];

/** Anchors created per page — tunes the anchor:page row-count ratio. */
const ANCHOR_FANOUT = 8;

/** Repeated warm requests per matrix entry, for p50/p95. */
const WARM_ITERATIONS = 30;

const CONFIG = {
	baseUrl: 'https://example.com',
	roots: ['https://example.com'],
};

/**
 * Simulates a missing archive sidecar file for benchmark-only accessor stubs.
 * @returns Never resolves successfully.
 */
async function getMissingData() {
	const error = new Error('not found');
	error.code = 'ENOENT';
	throw error;
}

/**
 * Sort combinations benchmarked per `broken-links-view.tsx`'s exposed sort
 * controls (`sourceUrl`/`destUrl`/`status`, both directions).
 */
const MATRIX = [
	{ label: 'default (sourceUrl asc)', query: 'type=broken&limit=100' },
	{
		label: 'sourceUrl desc',
		query: 'type=broken&limit=100&sortBy=sourceUrl&sortOrder=desc',
	},
	{ label: 'destUrl asc', query: 'type=broken&limit=100&sortBy=destUrl&sortOrder=asc' },
	{ label: 'status asc', query: 'type=broken&limit=100&sortBy=status&sortOrder=asc' },
	{ label: 'status desc', query: 'type=broken&limit=100&sortBy=status&sortOrder=desc' },
];

/**
 * Materialises a disk-backed synthetic archive DB with `n` `pages` rows and
 * `n * ANCHOR_FANOUT` `anchors` rows. Status mix (200/301/404/500/null)
 * matches `bench-viewer-pages-read-model.mjs`'s real-world skew. Anchor
 * targets are deterministic offsets from the source page index, including
 * one guaranteed duplicate target per page (exercises `count` dedup) and a
 * regular hit rate on 404 destinations (exercises `is_broken`).
 * @param {number} n - The number of page rows to insert.
 * @returns {Promise<{db: import('knex').Knex, dbFilePath: string, cleanupDir: string, anchorRowCount: number}>}
 *   The seeded Knex instance, its backing file/dir (for size + cleanup),
 *   and the total anchor row count inserted.
 */
async function makeDb(n) {
	const cleanupDir = path.join(
		tmpdir(),
		`nitpicker-bench-viewer-anchor-facts-${n}-${process.pid}`,
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
	const CHUNK = 100;

	const pageRows = [];
	for (let i = 0; i < n; i++) {
		const padded = String(i).padStart(8, '0');
		pageRows.push({
			url: `https://example.com/page-${padded}`,
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			isSkipped: 0,
			redirectDestId: null,
			status: STATUSES[i % STATUSES.length],
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 1000,
			title: `Page ${padded}`,
			source: 'crawled',
			tag_count: 0,
			jsonld_count: 0,
		});
		if (pageRows.length >= CHUNK) {
			await db('pages').insert(pageRows);
			pageRows.length = 0;
		}
	}
	if (pageRows.length > 0) {
		await db('pages').insert(pageRows);
	}

	const idRows = await db('pages').select('id').orderBy('id');
	const idByIndex = idRows.map((row) => row.id);

	let anchorRowCount = 0;
	const anchorRows = [];
	for (let i = 0; i < n; i++) {
		const sourceId = idByIndex[i];
		for (let k = 0; k < ANCHOR_FANOUT; k++) {
			// A fixed prime-step walk spreads targets across the whole page
			// set deterministically; k === ANCHOR_FANOUT - 1 repeats the k=0
			// target on purpose, so every page has at least one duplicate
			// (source,dest) pair collapsing into a viewer_anchor_facts row
			// with count=2.
			const step = k === ANCHOR_FANOUT - 1 ? 0 : k;
			const targetIndex = (i + 1 + step * 97) % n;
			anchorRows.push({ pageId: sourceId, hrefId: idByIndex[targetIndex] });
			anchorRowCount++;
		}
		if (anchorRows.length >= CHUNK) {
			await db('anchors').insert(anchorRows);
			anchorRows.length = 0;
		}
	}
	if (anchorRows.length > 0) {
		await db('anchors').insert(anchorRows);
	}

	return { db, dbFilePath, cleanupDir, anchorRowCount };
}

/**
 * Builds the viewer read model against the seeded DB, timing the build and
 * measuring the DB file's size delta.
 * @param {import('knex').Knex} db - The seeded Knex instance.
 * @param {string} dbFilePath - The DB's backing file path (for `statSync`).
 * @returns {Promise<{buildMs: number, sizeBeforeBytes: number, sizeAfterBytes: number, anchorFactRowCount: number}>}
 *   Build timing and size metrics.
 */
async function buildReadModel(db, dbFilePath) {
	const sizeBeforeBytes = statSync(dbFilePath).size;
	const accessorStub = {
		readOnly: false,
		getKnex: () => db,
		getConfig: async () => CONFIG,
		getData: getMissingData,
	};
	const start = process.hrtime.bigint();
	await buildViewerReadModel(accessorStub);
	const buildMs = Number(process.hrtime.bigint() - start) / 1e6;
	const sizeAfterBytes = statSync(dbFilePath).size;

	const anchorFactRowCount = await db('viewer_anchor_facts').count('* as count');

	return {
		buildMs,
		sizeBeforeBytes,
		sizeAfterBytes,
		anchorFactRowCount: Number(anchorFactRowCount[0]?.count ?? 0),
	};
}

/**
 * Runs `EXPLAIN QUERY PLAN` for one matrix entry's window query, built via
 * `db.raw` against the same `is_broken = 1` + `ORDER BY` shape
 * `list-viewer-broken-links.ts`'s `readAnchorFactsWindow` issues.
 * @param {import('knex').Knex} db - The Knex instance.
 * @param {string} orderByColumns - The `ORDER BY` column list (no `is_broken` — that's a fixed `WHERE`).
 * @returns {Promise<string>} One `|`-joined line of `EXPLAIN QUERY PLAN` detail rows.
 */
async function explainMatrixEntry(db, orderByColumns) {
	const sql = `SELECT edge_id FROM viewer_anchor_facts WHERE is_broken = 1 ORDER BY ${orderByColumns} LIMIT 101`;
	const plan = await db.raw(`EXPLAIN QUERY PLAN ${sql}`);
	return plan.map((row) => row.detail).join(' | ');
}

/**
 * Times `iterations` sequential HTTP round-trips through the real Hono app
 * for one query string, returning p50/p95 in milliseconds.
 * @param {import('hono').Hono} app - The app under test.
 * @param {string} query - The `/api/links` query string (no leading `?`).
 * @param {number} iterations - Number of warm requests to time.
 * @returns {Promise<{p50: number, p95: number}>} Warm latency percentiles.
 */
async function timeWarmRequests(app, query, iterations) {
	const timings = [];
	for (let i = 0; i < iterations; i++) {
		const start = process.hrtime.bigint();
		const res = await app.request(`/api/links?${query}`);
		await res.text();
		timings.push(Number(process.hrtime.bigint() - start) / 1e6);
	}
	timings.sort((a, b) => a - b);
	const p50 = timings[Math.floor(timings.length * 0.5)];
	const p95 = timings[Math.floor(timings.length * 0.95)];
	return { p50, p95 };
}

const EXPLAIN_ORDER_BY = {
	'default (sourceUrl asc)': 'source_url_ref_id, edge_id',
	'sourceUrl desc': 'source_url_ref_id DESC, edge_id DESC',
	'destUrl asc': 'dest_url_ref_id, edge_id',
	'status asc': 'status_sort_key, source_url_ref_id, edge_id',
	'status desc': 'status_desc_key, source_url_ref_id, edge_id',
};

/**
 * Runs the full matrix (EXPLAIN + cold/warm HTTP timing) against one
 * already-built read model, printing a results table and a copy-pasteable
 * Markdown summary block.
 * @param {import('knex').Knex} db - The Knex instance with a built read model.
 * @param {number} n - The page-row count this DB was seeded with (for the report header).
 */
async function runMatrix(db, n) {
	const accessorStub = {
		getKnex: () => db,
		getConfig: async () => CONFIG,
		getData: getMissingData,
	};
	const app = createApp({
		context: { archiveId: 'bench', manager: { get: () => accessorStub } },
		publicDir: '/tmp/no-such-dir-bench',
	});

	const results = [];
	for (const entry of MATRIX) {
		const explain = await explainMatrixEntry(db, EXPLAIN_ORDER_BY[entry.label]);
		const coldStart = process.hrtime.bigint();
		const coldRes = await app.request(`/api/links?${entry.query}`);
		await coldRes.text();
		const coldMs = Number(process.hrtime.bigint() - coldStart) / 1e6;
		const { p50, p95 } = await timeWarmRequests(app, entry.query, WARM_ITERATIONS);
		results.push({ ...entry, coldMs, p50, p95, explain });
	}

	console.log('\n  sort                                cold      p50      p95');
	for (const r of results) {
		console.log(
			`  ${r.label.padEnd(35)} ${`${r.coldMs.toFixed(1)}ms`.padStart(8)} ${`${r.p50.toFixed(1)}ms`.padStart(8)} ${`${r.p95.toFixed(1)}ms`.padStart(8)}`,
		);
		console.log(`      EXPLAIN: ${r.explain}`);
	}

	console.log(
		'\n### Markdown summary (paste into PR/ARCHITECTURE.md, no archive-identifying details)\n',
	);
	console.log(
		`\`${n.toLocaleString()} synthetic pages\` — /api/links?type=broken viewer_anchor_facts fast path:\n`,
	);
	console.log('| sort | cold | warm p50 | warm p95 | EXPLAIN QUERY PLAN |');
	console.log('| --- | --- | --- | --- | --- |');
	for (const r of results) {
		console.log(
			`| ${r.label} | ${r.coldMs.toFixed(1)}ms | ${r.p50.toFixed(1)}ms | ${r.p95.toFixed(1)}ms | ${r.explain} |`,
		);
	}

	// listViewerBrokenLinks function-level sanity check — confirms the HTTP
	// numbers above aren't dominated by Hono/JSON overhead alone.
	const directStart = process.hrtime.bigint();
	await listViewerBrokenLinks(accessorStub, { limit: 100 });
	const directMs = Number(process.hrtime.bigint() - directStart) / 1e6;
	console.log(
		`\nDirect \`listViewerBrokenLinks\` call (no HTTP layer), default sort: ${directMs.toFixed(1)}ms`,
	);
}

for (const n of SIZES) {
	console.log(
		`\n══════════ ${n.toLocaleString()} pages (~${(n * ANCHOR_FANOUT).toLocaleString()} anchors) ══════════`,
	);
	const { db, dbFilePath, cleanupDir, anchorRowCount } = await makeDb(n);
	try {
		const seedSizeBytes = statSync(dbFilePath).size;
		console.log(`  seeded DB size: ${(seedSizeBytes / 1024 / 1024).toFixed(1)} MiB`);
		console.log(`  anchors inserted: ${anchorRowCount.toLocaleString()}`);

		const { buildMs, sizeBeforeBytes, sizeAfterBytes, anchorFactRowCount } =
			await buildReadModel(db, dbFilePath);
		const addedBytes = sizeAfterBytes - sizeBeforeBytes;
		console.log(`  read-model build time: ${buildMs.toFixed(0)}ms`);
		console.log(
			`  read-model added DB size: ${(addedBytes / 1024 / 1024).toFixed(1)} MiB (viewer_anchor_facts rows after edge dedup: ${anchorFactRowCount.toLocaleString()})`,
		);

		await runMatrix(db, n);
	} finally {
		await db.destroy();
		rmSync(cleanupDir, { recursive: true, force: true });
	}
}
console.log('\nDone.');
