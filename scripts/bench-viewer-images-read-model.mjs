#!/usr/bin/env node
/**
 * Benchmarks `/api/images`'s `viewer_images` read-model fast path (issue
 * #113) on a synthetic archive — no real customer archive is ever read or
 * referenced.
 *
 * Records, mirroring `bench-viewer-resources-read-model.mjs`'s Benchmark
 * Contract:
 *
 *   - row count / read-model build time / added DB size
 *   - `listImages` (legacy, before) vs `listViewerImages` (read-model,
 *     after) direct function-level cold timing
 *   - `/api/images` cold HTTP timing through the real Hono app, once before
 *     and once after the read model exists
 *   - `EXPLAIN QUERY PLAN` for the default (`pageUrl`) and a filtered
 *     (`missingAlt`) read shape of `viewer_images`
 *
 * USAGE
 * -----
 *
 *     yarn build && node scripts/bench-viewer-images-read-model.mjs
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
import { listImages } from '../packages/@nitpicker/query/lib/list-images.js';
import { listViewerImages } from '../packages/@nitpicker/query/lib/list-viewer-images.js';
import { buildViewerReadModel } from '../packages/@nitpicker/query/lib/viewer-read-model/build-viewer-read-model.js';
import { createApp } from '../packages/@nitpicker/viewer/lib/create-app.js';

const SIZES = process.env.BENCH_SIZES
	? process.env.BENCH_SIZES.split(',').map((s) => Number(s.trim()))
	: [400_000];

/** Fixed config payload every seeded archive reports via `accessor.getConfig()`. */
const CONFIG = { baseUrl: 'https://example.com', roots: ['https://example.com'] };

/** Rows per multi-row `INSERT` — libsql tops out around a few hundred bound values. */
const CHUNK = 200;

/** Images per page — a realistic ratio driving `images` well past `pages` in row count. */
const IMAGES_PER_PAGE = 8;

/**
 * Materialises a disk-backed synthetic archive DB with `n` `images` rows (a
 * realistic mix: ~10% missing alt, ~5% missing dimensions, ~2% oversized)
 * spread across `n / IMAGES_PER_PAGE` `pages` rows.
 * @param {number} n - The number of image rows to insert.
 * @returns {Promise<{db: import('knex').Knex, dbFilePath: string, cleanupDir: string}>}
 *   The seeded Knex instance and its backing file/dir (for size + cleanup).
 */
async function makeDb(n) {
	const cleanupDir = path.join(
		tmpdir(),
		`nitpicker-bench-viewer-images-${n}-${process.pid}`,
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

	const pageCount = Math.ceil(n / IMAGES_PER_PAGE);
	const pageIds = [];
	let pageRows = [];
	for (let i = 0; i < pageCount; i++) {
		pageRows.push({
			url: `https://example.com/page-${i}`,
			scraped: 1,
			isTarget: 1,
			contentType: 'text/html',
			isExternal: 0,
		});
		if (pageRows.length >= CHUNK) {
			const inserted = await db('pages').insert(pageRows).returning('id');
			pageIds.push(...inserted.map((row) => row.id));
			pageRows = [];
		}
	}
	if (pageRows.length > 0) {
		const inserted = await db('pages').insert(pageRows).returning('id');
		pageIds.push(...inserted.map((row) => row.id));
	}

	// Bucket layout per 100-row cycle: [0,10) missing alt, [10,15) missing
	// dimensions, [15,17) oversized, [17,100) unremarkable.
	let imageRows = [];
	for (let i = 0; i < n; i++) {
		const bucket = i % 100;
		const missingAlt = bucket < 10;
		const missingDimensions = bucket >= 10 && bucket < 15;
		const oversized = bucket >= 15 && bucket < 17;
		imageRows.push({
			pageId: pageIds[i % pageIds.length],
			src: `https://example.com/image-${i}.png`,
			currentSrc: `https://example.com/image-${i}.png`,
			alt: missingAlt ? '' : `Image ${i}`,
			width: missingDimensions ? 0 : 100,
			height: missingDimensions ? 0 : 100,
			naturalWidth: oversized ? 5000 : 100,
			naturalHeight: oversized ? 5000 : 100,
			isLazy: bucket % 2 === 0 ? 1 : 0,
			viewportWidth: 1280,
			sourceCode: `<img src="image-${i}.png">`,
		});
		if (imageRows.length >= CHUNK) {
			await db('images').insert(imageRows);
			imageRows = [];
		}
	}
	if (imageRows.length > 0) {
		await db('images').insert(imageRows);
	}

	return { db, dbFilePath, cleanupDir };
}

/**
 * Builds a minimal accessor stub satisfying the surface
 * `listImages`/`listViewerImages`/`buildViewerReadModel` need.
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
	console.log(`\n══════════ ${n.toLocaleString()} images ══════════`);
	const { db, dbFilePath, cleanupDir } = await makeDb(n);
	try {
		const seedSizeBytes = statSync(dbFilePath).size;
		console.log(`  seeded DB size: ${(seedSizeBytes / 1024 / 1024).toFixed(1)} MiB`);

		const accessorStub = makeAccessorStub(db);

		// BEFORE: legacy direct call (wide `images` join `pages`).
		const legacyStart = process.hrtime.bigint();
		const legacyImages = await listImages(accessorStub, { limit: 100 });
		const legacyMs = Number(process.hrtime.bigint() - legacyStart) / 1e6;
		console.log(`  direct listImages() (legacy): ${legacyMs.toFixed(1)}ms`);

		const legacyApp = makeApp(accessorStub, 'bench-legacy');
		const legacyHttpStart = process.hrtime.bigint();
		const legacyRes = await legacyApp.request('/api/images');
		await legacyRes.text();
		const legacyHttpMs = Number(process.hrtime.bigint() - legacyHttpStart) / 1e6;
		console.log(`  HTTP /api/images (legacy): ${legacyHttpMs.toFixed(1)}ms`);

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

		// AFTER: read-model direct call.
		const fastStart = process.hrtime.bigint();
		const fastImages = await listViewerImages(accessorStub, { limit: 100 });
		const fastMs = Number(process.hrtime.bigint() - fastStart) / 1e6;
		console.log(`  direct listViewerImages() (read model): ${fastMs.toFixed(1)}ms`);

		const fastApp = makeApp(accessorStub, 'bench-read-model');
		const fastHttpStart = process.hrtime.bigint();
		const fastRes = await fastApp.request('/api/images');
		await fastRes.text();
		const fastHttpMs = Number(process.hrtime.bigint() - fastHttpStart) / 1e6;
		console.log(`  HTTP /api/images (read model): ${fastHttpMs.toFixed(1)}ms`);

		const fastFilteredStart = process.hrtime.bigint();
		await listViewerImages(accessorStub, { missingAlt: true, limit: 100 });
		const fastFilteredMs = Number(process.hrtime.bigint() - fastFilteredStart) / 1e6;
		console.log(
			`  direct listViewerImages({missingAlt:true}) (read model): ${fastFilteredMs.toFixed(1)}ms`,
		);

		const defaultPlan = await db.raw(
			'EXPLAIN QUERY PLAN select image_id from viewer_images order by page_url_rank, image_id limit 100',
		);
		const missingAltPlan = await db.raw(
			'EXPLAIN QUERY PLAN select image_id from viewer_images where missing_alt = 1 order by page_url_rank, image_id limit 100',
		);
		console.log(
			`  EXPLAIN (viewer_images default): ${defaultPlan.map((row) => row.detail).join(' | ')}`,
		);
		console.log(
			`  EXPLAIN (viewer_images missing_alt=1): ${missingAltPlan.map((row) => row.detail).join(' | ')}`,
		);

		// Sanity check — both backends must agree on total counts.
		if (legacyImages.total !== fastImages.total) {
			throw new Error(
				`legacy listImages() and listViewerImages() disagree on total: ${legacyImages.total} vs ${fastImages.total}`,
			);
		}

		console.log(
			'\n### Markdown summary (paste into PR/CLAUDE.md, no archive-identifying details)\n',
		);
		console.log(
			`\`${n.toLocaleString()} synthetic images\` — viewer_images fast path:\n`,
		);
		console.log('| endpoint | phase | direct call | HTTP |');
		console.log('| --- | --- | --- | --- |');
		console.log(
			`| /api/images | legacy (before) | ${legacyMs.toFixed(1)}ms | ${legacyHttpMs.toFixed(1)}ms |`,
		);
		console.log(
			`| /api/images | read model (after) | ${fastMs.toFixed(1)}ms | ${fastHttpMs.toFixed(1)}ms |`,
		);
		console.log(`\nread-model build time: ${buildMs.toFixed(0)}ms`);
	} finally {
		await db.destroy();
		rmSync(cleanupDir, { recursive: true, force: true });
	}
}
console.log('\nDone.');
