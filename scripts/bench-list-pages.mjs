#!/usr/bin/env node
/**
 * Benchmarks the `listPages` query path at several archive sizes by
 * synthesising rows directly via Knex INSERT and running the same EXPLAIN
 * + timing matrix as {@link ./profile-list-pages.mjs}.
 *
 * Used to characterise how the default Pages-view filter scales without
 * needing access to a real customer archive. The schema is borrowed from
 * the crawler's built `lib/archive/init-schema.js` so the indexes and
 * column shapes exactly match what real archives have.
 *
 * USAGE
 * -----
 *
 *     yarn build && node scripts/bench-list-pages.mjs
 *
 * Sizes default to {1k, 10k, 50k, 100k}; override via `BENCH_SIZES=…`
 * (comma-separated). Each archive is built in-memory (`:memory:`).
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import knex from 'knex';

import { initSchema } from '../packages/@nitpicker/crawler/lib/archive/init-schema.js';
import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';
import { listPages } from '../packages/@nitpicker/query/lib/list-pages.js';
import { createApp } from '../packages/@nitpicker/viewer/lib/create-app.js';

const SIZES = process.env.BENCH_SIZES
	? process.env.BENCH_SIZES.split(',').map((s) => Number(s.trim()))
	: [10_000, 100_000, 500_000];

/** When set (`BENCH_DISK=1`) bench runs against a disk-backed temp file. */
const USE_DISK = process.env.BENCH_DISK === '1';

const MATRIX = [
	{ limit: 50, offset: 0 },
	{ limit: 100, offset: 0 },
	{ limit: 100, offset: 100 },
	{ limit: 100, offset: 1000 },
	{ limit: 100, offset: 10_000 },
	{ limit: 100, offset: 50_000 },
	{ limit: 200, offset: 0 },
];

/**
 * Materialises an in-memory DB with `n` synthetic page rows that match the
 * default Pages-view filter.
 * @param {number} n - The number of rows to insert.
 * @returns {Promise<import('knex').Knex>} The Knex instance.
 */
async function makeDb(n) {
	let filename = ':memory:';
	let cleanupDir = null;
	if (USE_DISK) {
		cleanupDir = path.join(tmpdir(), `nitpicker-bench-${n}-${process.pid}`);
		rmSync(cleanupDir, { recursive: true, force: true });
		mkdirSync(cleanupDir, { recursive: true });
		filename = path.join(cleanupDir, 'db.sqlite');
	}
	const db = knex({
		client: LibsqlDialect,
		connection: { filename },
		useNullAsDefault: true,
	});
	db._benchCleanupDir = cleanupDir;
	await initSchema(db);

	// libsql tops out around a few hundred values per multi-row INSERT
	// statement before complaining about parameter count; 100 keeps us
	// comfortably under that limit while still amortising round-trips.
	const CHUNK = 100;
	const rows = [];
	for (let i = 0; i < n; i++) {
		const padded = String(i).padStart(8, '0');
		rows.push({
			url: `https://example.com/page-${padded}`,
			scraped: 1,
			isTarget: 1,
			isExternal: 0,
			redirectDestId: null,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 1000,
			lang: 'ja',
			title: `Page ${padded}`,
			description: `Synthetic page ${padded} for bench`,
			source: 'crawled',
		});
		if (rows.length >= CHUNK) {
			await db('pages').insert(rows);
			rows.length = 0;
		}
	}
	if (rows.length > 0) {
		await db('pages').insert(rows);
	}
	return db;
}

/**
 * Runs the EXPLAIN + timing matrix against an already-seeded DB.
 * @param {import('knex').Knex} db - The Knex instance bound to the DB.
 */
async function runBench(db) {
	const explainCount = await db.raw(
		`EXPLAIN QUERY PLAN
		 SELECT count(id) AS total FROM pages
		 WHERE scraped = 1 AND redirectDestId IS NULL
		 AND (contentType IS NULL OR contentType = 'text/html')`,
	);
	console.log('  COUNT plan:');
	for (const row of explainCount) console.log(`    ${row.detail}`);

	const explainSelect = await db.raw(
		`EXPLAIN QUERY PLAN
		 SELECT id, url, title, status FROM pages
		 WHERE scraped = 1 AND redirectDestId IS NULL
		 AND (contentType IS NULL OR contentType = 'text/html')
		 ORDER BY url ASC LIMIT 100 OFFSET 0`,
	);
	console.log('  SELECT plan:');
	for (const row of explainSelect) console.log(`    ${row.detail}`);

	// Build a Hono app pointing at our seeded DB via a stub ArchiveContext.
	// `manager.get()` is the only method the routes call; `archiveId` value
	// is irrelevant since we hand back the same accessor for every call.
	const accessorStub = { getKnex: () => db };
	const app = createApp({
		context: {
			archiveId: 'bench',
			manager: { get: () => accessorStub },
		},
		publicDir: '/tmp/no-such-dir-bench',
	});

	console.log('  limit  offset      COUNT  rawSELECT  listPages    HTTP');
	const baseFilterCount = await db('pages')
		.where('scraped', 1)
		.whereNull('redirectDestId')
		.where((qb) => qb.whereNull('contentType').orWhere('contentType', 'text/html'))
		.count('id as total');
	const baseFilterRows = Number(baseFilterCount[0]?.total ?? 0);
	for (const { limit, offset } of MATRIX) {
		if (offset >= baseFilterRows) {
			console.log(
				`  ${String(limit).padStart(5)}  ${String(offset).padStart(8)}     (skipped)`,
			);
			continue;
		}
		const countStart = process.hrtime.bigint();
		await db('pages')
			.where('scraped', 1)
			.whereNull('redirectDestId')
			.where((qb) => qb.whereNull('contentType').orWhere('contentType', 'text/html'))
			.count('id as total');
		const countMs = Number(process.hrtime.bigint() - countStart) / 1e6;

		const selectStart = process.hrtime.bigint();
		await db('pages')
			.where('scraped', 1)
			.whereNull('redirectDestId')
			.where((qb) => qb.whereNull('contentType').orWhere('contentType', 'text/html'))
			.select('id', 'url', 'title', 'status', 'lang', 'description')
			.orderBy('url', 'asc')
			.limit(limit)
			.offset(offset);
		const selectMs = Number(process.hrtime.bigint() - selectStart) / 1e6;

		// Full listPages path (paginateQuery + mapRow + DTO).
		const fullStart = process.hrtime.bigint();
		await listPages(accessorStub, { limit, offset });
		const fullMs = Number(process.hrtime.bigint() - fullStart) / 1e6;

		// HTTP round-trip via Hono's in-process `app.request` — exercises
		// the actual route handler, query-param parsing, JSON serialize, and
		// the Server-Timing middleware. Closes the gap between "SQL is fast"
		// and "the API is fast".
		const httpStart = process.hrtime.bigint();
		const res = await app.request(`/api/pages?limit=${limit}&offset=${offset}`);
		await res.text();
		const httpMs = Number(process.hrtime.bigint() - httpStart) / 1e6;

		console.log(
			`  ${String(limit).padStart(5)}  ${String(offset).padStart(8)}  ${`${countMs.toFixed(1)}ms`.padStart(9)}  ${`${selectMs.toFixed(1)}ms`.padStart(9)}  ${`${fullMs.toFixed(1)}ms`.padStart(9)}  ${`${httpMs.toFixed(1)}ms`.padStart(7)}`,
		);
	}
}

for (const n of SIZES) {
	console.log(`\n══════════ ${n.toLocaleString()} rows ══════════`);
	const seedStart = process.hrtime.bigint();
	const db = await makeDb(n);
	const seedMs = Number(process.hrtime.bigint() - seedStart) / 1e6;
	console.log(`  seed: ${seedMs.toFixed(0)}ms`);
	try {
		await runBench(db);
	} finally {
		const dir = db._benchCleanupDir;
		await db.destroy();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
}
console.log('\nDone.');
