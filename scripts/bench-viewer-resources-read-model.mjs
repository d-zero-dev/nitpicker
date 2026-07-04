#!/usr/bin/env node
/**
 * Benchmarks `/api/resources`'s and `/api/unused-resources`'s
 * `viewer_resources`/`viewer_resource_stats` read-model fast path (issue
 * #110) on a synthetic archive — no real customer archive is ever read or
 * referenced.
 *
 * Records, mirroring `bench-viewer-error-kinds-read-model.mjs`'s Benchmark
 * Contract:
 *
 *   - row count / read-model build time / added DB size
 *   - `listResources`/`listUnusedResources` (legacy, before) vs
 *     `listViewerResources`/`listViewerUnusedResources` (read-model, after)
 *     direct function-level cold timing
 *   - `/api/resources` and `/api/unused-resources` cold HTTP timing through
 *     the real Hono app, once before and once after the read model exists
 *   - `EXPLAIN QUERY PLAN` for the default/filtered read shapes of
 *     `viewer_resources`
 *   - `/api/resources/referrers` is NOT read-model-dependent (see
 *     `get-resource-referrers.ts`'s docs — `resources-referrers` already has
 *     a `(resourceId, pageId)` index) — this script only confirms that via
 *     `EXPLAIN QUERY PLAN`, no before/after split.
 *
 * USAGE
 * -----
 *
 *     yarn build && node scripts/bench-viewer-resources-read-model.mjs
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
import { listResources } from '../packages/@nitpicker/query/lib/list-resources.js';
import { listUnusedResources } from '../packages/@nitpicker/query/lib/list-unused-resources.js';
import { listViewerResources } from '../packages/@nitpicker/query/lib/list-viewer-resources.js';
import { listViewerUnusedResources } from '../packages/@nitpicker/query/lib/list-viewer-unused-resources.js';
import { buildViewerReadModel } from '../packages/@nitpicker/query/lib/viewer-read-model/build-viewer-read-model.js';
import { createApp } from '../packages/@nitpicker/viewer/lib/create-app.js';

const SIZES = process.env.BENCH_SIZES
	? process.env.BENCH_SIZES.split(',').map((s) => Number(s.trim()))
	: [400_000];

/** Fixed config payload every seeded archive reports via `accessor.getConfig()`. */
const CONFIG = { baseUrl: 'https://example.com', roots: ['https://example.com'] };

/** Referring-page pool size — real `pages` rows are required for the `resources-referrers.pageId` foreign key. */
const PAGE_POOL_SIZE = 2000;

/** Rows per multi-row `INSERT` — libsql tops out around a few hundred bound values. */
const CHUNK = 200;

/**
 * Materialises a disk-backed synthetic archive DB with `n` `resources` rows
 * (a realistic mix: ~60% referenced internal, ~25% unreferenced internal —
 * the "unused" candidates, ~15% external) plus a small `pages` pool for
 * `resources-referrers` foreign keys.
 * @param {number} n - The number of resource rows to insert.
 * @returns {Promise<{db: import('knex').Knex, dbFilePath: string, cleanupDir: string}>}
 *   The seeded Knex instance and its backing file/dir (for size + cleanup).
 */
async function makeDb(n) {
	const cleanupDir = path.join(
		tmpdir(),
		`nitpicker-bench-viewer-resources-${n}-${process.pid}`,
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

	// Seed the referring-page pool first (resources-referrers.pageId FK).
	let pageRows = [];
	for (let i = 0; i < PAGE_POOL_SIZE; i++) {
		pageRows.push({ url: `https://example.com/page-${i}`, scraped: 1, isTarget: 1 });
		if (pageRows.length >= CHUNK) {
			await db('pages').insert(pageRows);
			pageRows = [];
		}
	}
	if (pageRows.length > 0) {
		await db('pages').insert(pageRows);
	}

	// Bucket layout per 20-row cycle: [0,12) referenced-internal,
	// [12,17) unreferenced-internal (the "unused" candidates), [17,20) external.
	let resourceRows = [];
	let referrerRows = [];
	let chunkStartIndex = 0;
	for (let i = 0; i < n; i++) {
		const bucket = i % 20;
		const isExternal = bucket >= 17;
		resourceRows.push({
			url: `https://${isExternal ? 'cdn.example.net' : 'example.com'}/resource-${i}.js`,
			isExternal: isExternal ? 1 : 0,
			status: 200,
			statusText: 'OK',
			contentType: 'application/javascript',
			contentLength: 1000,
			compress: 0,
			cdn: 0,
			source: 'crawled',
		});
		if (resourceRows.length >= CHUNK) {
			const inserted = await db('resources').insert(resourceRows).returning('id');
			for (const [index, row] of inserted.entries()) {
				const globalIndex = chunkStartIndex + index;
				if (globalIndex % 20 < 12) {
					referrerRows.push({
						resourceId: row.id,
						pageId: (globalIndex % PAGE_POOL_SIZE) + 1,
					});
				}
			}
			chunkStartIndex = i + 1;
			resourceRows = [];
		}
		if (referrerRows.length >= CHUNK) {
			await db('resources-referrers').insert(referrerRows);
			referrerRows = [];
		}
	}
	if (resourceRows.length > 0) {
		const inserted = await db('resources').insert(resourceRows).returning('id');
		for (const [index, row] of inserted.entries()) {
			const globalIndex = chunkStartIndex + index;
			if (globalIndex % 20 < 12) {
				referrerRows.push({
					resourceId: row.id,
					pageId: (globalIndex % PAGE_POOL_SIZE) + 1,
				});
			}
		}
	}
	if (referrerRows.length > 0) {
		await db('resources-referrers').insert(referrerRows);
	}

	return { db, dbFilePath, cleanupDir };
}

/**
 * Builds a minimal accessor stub satisfying the surface
 * `listResources`/`listUnusedResources`/`listViewerResources`/
 * `listViewerUnusedResources`/`buildViewerReadModel` need.
 * @param {import('knex').Knex} db - The seeded/built Knex instance.
 * @returns {object} An `ArchiveAccessor`-shaped stub.
 */
function makeAccessorStub(db) {
	return { readOnly: false, getKnex: () => db, getConfig: async () => CONFIG };
}

/**
 * Builds a Hono app wired to one `archiveId` mapped to the given accessor.
 * @param {object} accessorStub - The accessor to serve.
 * @param {string} archiveId - Unique id for this phase.
 * @returns {import('hono').Hono} The configured app.
 */
function makeApp(accessorStub, archiveId) {
	return createApp({
		context: { archiveId, manager: { get: () => accessorStub }, mode: 'archive' },
		publicDir: '/tmp/no-such-dir-bench',
	});
}

for (const n of SIZES) {
	console.log(`\n══════════ ${n.toLocaleString()} resources ══════════`);
	const { db, dbFilePath, cleanupDir } = await makeDb(n);
	try {
		const seedSizeBytes = statSync(dbFilePath).size;
		console.log(`  seeded DB size: ${(seedSizeBytes / 1024 / 1024).toFixed(1)} MiB`);

		const accessorStub = makeAccessorStub(db);

		// BEFORE: legacy direct calls (correlated subquery / anti-join).
		const legacyResourcesStart = process.hrtime.bigint();
		const legacyResources = await listResources(accessorStub, { limit: 100 });
		const legacyResourcesMs =
			Number(process.hrtime.bigint() - legacyResourcesStart) / 1e6;
		console.log(`  direct listResources() (legacy): ${legacyResourcesMs.toFixed(1)}ms`);

		const legacyUnusedStart = process.hrtime.bigint();
		const legacyUnused = await listUnusedResources(accessorStub, { limit: 100 });
		const legacyUnusedMs = Number(process.hrtime.bigint() - legacyUnusedStart) / 1e6;
		console.log(
			`  direct listUnusedResources() (legacy): ${legacyUnusedMs.toFixed(1)}ms`,
		);

		const legacyApp = makeApp(accessorStub, 'bench-legacy');
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
		await buildViewerReadModel(accessorStub);
		const buildMs = Number(process.hrtime.bigint() - buildStart) / 1e6;
		const sizeAfterBytes = statSync(dbFilePath).size;
		console.log(`  read-model build time: ${buildMs.toFixed(0)}ms`);
		console.log(
			`  read-model added DB size: ${((sizeAfterBytes - sizeBeforeBytes) / 1024 / 1024).toFixed(1)} MiB`,
		);

		// AFTER: read-model direct calls.
		const fastResourcesStart = process.hrtime.bigint();
		const fastResources = await listViewerResources(accessorStub, { limit: 100 });
		const fastResourcesMs = Number(process.hrtime.bigint() - fastResourcesStart) / 1e6;
		console.log(
			`  direct listViewerResources() (read model): ${fastResourcesMs.toFixed(1)}ms`,
		);

		const fastUnusedStart = process.hrtime.bigint();
		const fastUnused = await listViewerUnusedResources(accessorStub, { limit: 100 });
		const fastUnusedMs = Number(process.hrtime.bigint() - fastUnusedStart) / 1e6;
		console.log(
			`  direct listViewerUnusedResources() (read model): ${fastUnusedMs.toFixed(1)}ms`,
		);

		const fastApp = makeApp(accessorStub, 'bench-read-model');
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

		const defaultPlan = await db.raw(
			'EXPLAIN QUERY PLAN select resource_id from viewer_resources order by url_sort_key, resource_id limit 100',
		);
		const unusedPlan = await db.raw(
			'EXPLAIN QUERY PLAN select resource_id from viewer_resources where is_unused = 1 order by url_sort_key, resource_id limit 100',
		);
		const referrersPlan = await db.raw(
			'EXPLAIN QUERY PLAN select "pages"."url" from "resources-referrers" join "pages" on "pages"."id" = "resources-referrers"."pageId" where "resources-referrers"."resourceId" = 1 and "resources-referrers"."pageId" > 0 order by "resources-referrers"."pageId" asc limit 101',
		);
		console.log(
			`  EXPLAIN (viewer_resources default): ${defaultPlan.map((row) => row.detail).join(' | ')}`,
		);
		console.log(
			`  EXPLAIN (viewer_resources is_unused=1): ${unusedPlan.map((row) => row.detail).join(' | ')}`,
		);
		console.log(
			`  EXPLAIN (resources-referrers, unaffected by this read model): ${referrersPlan.map((row) => row.detail).join(' | ')}`,
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

		console.log(
			'\n### Markdown summary (paste into PR/CLAUDE.md, no archive-identifying details)\n',
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
		await db.destroy();
		rmSync(cleanupDir, { recursive: true, force: true });
	}
}
console.log('\nDone.');
