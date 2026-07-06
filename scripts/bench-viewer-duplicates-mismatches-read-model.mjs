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
 *     direct function-level cold timing
 *   - `/api/duplicates` and `/api/mismatches` cold HTTP timing through the
 *     real Hono app, once before and once after the read model exists
 *   - `EXPLAIN QUERY PLAN` for the default read shapes of
 *     `viewer_duplicate_groups`/`viewer_duplicate_group_pages`/`viewer_mismatches`
 *
 * USAGE
 * -----
 *
 *     yarn build && node scripts/bench-viewer-duplicates-mismatches-read-model.mjs
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
import { findDuplicates } from '../packages/@nitpicker/query/lib/find-duplicates.js';
import { findMismatches } from '../packages/@nitpicker/query/lib/find-mismatches.js';
import { getDuplicatesFastPath } from '../packages/@nitpicker/query/lib/get-duplicates-fast-path.js';
import { getMismatchesFastPath } from '../packages/@nitpicker/query/lib/get-mismatches-fast-path.js';
import { buildViewerReadModel } from '../packages/@nitpicker/query/lib/viewer-read-model/build-viewer-read-model.js';
import { createApp } from '../packages/@nitpicker/viewer/lib/create-app.js';

const SIZES = process.env.BENCH_SIZES
	? process.env.BENCH_SIZES.split(',').map((s) => Number(s.trim()))
	: [400_000];

/** Fixed config payload every seeded archive reports via `accessor.getConfig()`. */
const CONFIG = { baseUrl: 'https://example.com', roots: ['https://example.com'] };

/** Rows per multi-row `INSERT` — libsql tops out around a few hundred bound values. */
const CHUNK = 200;

/** Members per duplicate-title / duplicate-description group. */
const GROUP_SIZE = 10;

/**
 * Materialises a disk-backed synthetic archive DB with `n` internal HTML
 * `pages` rows, mixing:
 *
 *   - ~1/GROUP_SIZE distinct `title` values, each shared by `GROUP_SIZE`
 *     pages (every title value is a duplicate group)
 *   - ~1/GROUP_SIZE distinct `description` values, same pattern, offset so
 *     the two dedupe axes don't trivially coincide
 *   - ~10% of pages with a `canonical` pointing at a different URL (a
 *     canonical mismatch)
 *   - ~10% of pages with an `og_title` different from `title` (an og:title
 *     mismatch)
 * @param {number} n - The number of `pages` rows to insert.
 * @returns {Promise<{db: import('knex').Knex, dbFilePath: string, cleanupDir: string}>}
 *   The seeded Knex instance and its backing file/dir (for size + cleanup).
 */
async function makeDb(n) {
	const cleanupDir = path.join(
		tmpdir(),
		`nitpicker-bench-viewer-dup-mismatch-${n}-${process.pid}`,
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

	let rows = [];
	for (let i = 0; i < n; i++) {
		const titleGroup = Math.floor(i / GROUP_SIZE);
		const descriptionGroup = Math.floor((i + Math.floor(GROUP_SIZE / 2)) / GROUP_SIZE);
		const hasCanonicalMismatch = i % 10 === 0;
		const hasOgTitleMismatch = i % 10 === 5;
		const title = `Duplicate Title #${titleGroup}`;
		rows.push({
			url: `https://example.com/page-${i}`,
			scraped: 1,
			isExternal: 0,
			isTarget: 1,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			title,
			description: `Duplicate Description #${descriptionGroup}`,
			canonical: hasCanonicalMismatch
				? `https://example.com/canonical-target-${i}`
				: `https://example.com/page-${i}`,
			og_title: hasOgTitleMismatch ? `Different OG Title #${i}` : title,
		});
		if (rows.length >= CHUNK) {
			await db('pages').insert(rows);
			rows = [];
		}
	}
	if (rows.length > 0) {
		await db('pages').insert(rows);
	}

	return { db, dbFilePath, cleanupDir };
}

/**
 * Builds a minimal accessor stub satisfying the surface
 * `findDuplicates`/`findMismatches`/`getDuplicatesFastPath`/
 * `getMismatchesFastPath`/`buildViewerReadModel` need.
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
	console.log(`\n══════════ ${n.toLocaleString()} pages ══════════`);
	const { db, dbFilePath, cleanupDir } = await makeDb(n);
	try {
		const seedSizeBytes = statSync(dbFilePath).size;
		console.log(`  seeded DB size: ${(seedSizeBytes / 1024 / 1024).toFixed(1)} MiB`);

		const accessorStub = makeAccessorStub(db);

		// BEFORE: legacy direct calls.
		const legacyDupStart = process.hrtime.bigint();
		const legacyDuplicates = await findDuplicates(accessorStub, 'title', 50);
		const legacyDupMs = Number(process.hrtime.bigint() - legacyDupStart) / 1e6;
		console.log(`  direct findDuplicates() (legacy): ${legacyDupMs.toFixed(1)}ms`);

		const legacyMismatchStart = process.hrtime.bigint();
		// Paged-mode (options-object) call so `.total` is directly comparable to
		// `getMismatchesFastPath`'s `.total` below — the positional-args overload
		// only ever returns a bare, limit-capped array with no total count.
		const legacyMismatches = await findMismatches(accessorStub, 'canonical', {
			limit: 100,
		});
		const legacyMismatchMs = Number(process.hrtime.bigint() - legacyMismatchStart) / 1e6;
		console.log(`  direct findMismatches() (legacy): ${legacyMismatchMs.toFixed(1)}ms`);

		const legacyApp = makeApp(accessorStub, 'bench-legacy');
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
		await buildViewerReadModel(accessorStub);
		const buildMs = Number(process.hrtime.bigint() - buildStart) / 1e6;
		const sizeAfterBytes = statSync(dbFilePath).size;
		console.log(`  read-model build time: ${buildMs.toFixed(0)}ms`);
		console.log(
			`  read-model added DB size: ${((sizeAfterBytes - sizeBeforeBytes) / 1024 / 1024).toFixed(1)} MiB`,
		);

		// AFTER: read-model dispatch calls (getDuplicatesFastPath/getMismatchesFastPath
		// automatically prefer the read model once isViewerReadModelCurrent is true).
		const fastDupStart = process.hrtime.bigint();
		const fastDuplicates = await getDuplicatesFastPath(accessorStub, {
			field: 'title',
			limit: 50,
		});
		const fastDupMs = Number(process.hrtime.bigint() - fastDupStart) / 1e6;
		console.log(
			`  direct getDuplicatesFastPath() (read model): ${fastDupMs.toFixed(1)}ms`,
		);

		const fastMismatchStart = process.hrtime.bigint();
		const fastMismatches = await getMismatchesFastPath(accessorStub, 'canonical', {
			limit: 100,
		});
		const fastMismatchMs = Number(process.hrtime.bigint() - fastMismatchStart) / 1e6;
		console.log(
			`  direct getMismatchesFastPath() (read model): ${fastMismatchMs.toFixed(1)}ms`,
		);

		const fastApp = makeApp(accessorStub, 'bench-read-model');
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

		const groupsPlan = await db.raw(
			'EXPLAIN QUERY PLAN select group_id from viewer_duplicate_groups where field = ? order by count_desc_key, group_id limit 50',
			['title'],
		);
		const groupPagesPlan = await db.raw(
			'EXPLAIN QUERY PLAN select url_sort_key from viewer_duplicate_group_pages where group_id = ? order by url_sort_key, page_id limit 20',
			[1],
		);
		const mismatchesPlan = await db.raw(
			'EXPLAIN QUERY PLAN select url_sort_key from viewer_mismatches where type = ? order by url_sort_key, mismatch_id limit 100',
			['canonical'],
		);
		console.log(
			`  EXPLAIN (viewer_duplicate_groups): ${groupsPlan.map((row) => row.detail).join(' | ')}`,
		);
		console.log(
			`  EXPLAIN (viewer_duplicate_group_pages): ${groupPagesPlan.map((row) => row.detail).join(' | ')}`,
		);
		console.log(
			`  EXPLAIN (viewer_mismatches): ${mismatchesPlan.map((row) => row.detail).join(' | ')}`,
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

		console.log(
			'\n### Markdown summary (paste into PR/CLAUDE.md, no archive-identifying details)\n',
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
		await db.destroy();
		rmSync(cleanupDir, { recursive: true, force: true });
	}
}
console.log('\nDone.');
