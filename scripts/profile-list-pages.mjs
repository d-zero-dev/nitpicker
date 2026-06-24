#!/usr/bin/env node
/**
 * Profiles the `listPages` query path against a real `.nitpicker` archive
 * (or stub directory) to identify the bottleneck behind slow MPA pagination
 * clicks.
 *
 * For each (limit, offset) pair the script measures:
 *
 * - The COUNT(*) clone runtime (the `paginateQuery.total` step).
 * - The SELECT … LIMIT/OFFSET runtime (the `paginateQuery.items` step).
 * - The total wall-clock time the API would spend on this page.
 *
 * It also prints `EXPLAIN QUERY PLAN` for each shape so the user can see
 * whether SQLite picked an index-ordered scan or fell back to a full table
 * scan + sort. Combine these two pieces (timings + plan) to decide whether
 * the win is in a new index, a COUNT cache, or both.
 *
 * USAGE
 * -----
 *
 *     node scripts/profile-list-pages.mjs <archive.nitpicker | stub-dir>
 *
 * The archive is opened read-only — the original file is never modified.
 *
 * The script exercises the default Pages-view filter (`scraped = 1`
 * AND `redirectDestId IS NULL` AND `contentType IS NULL OR 'text/html'`)
 * with `ORDER BY url ASC`, which is what the viewer's Pages list runs out
 * of the box. Other filters (urlPattern, contentTypeCategory, …) are not
 * profiled here.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import path from 'node:path';
import process from 'node:process';

import { ArchiveManager } from '@nitpicker/query';

const archivePath = process.argv[2];
if (!archivePath) {
	console.error(
		'Usage: node scripts/profile-list-pages.mjs <archive.nitpicker | stub-dir>',
	);
	process.exit(1);
}

const resolved = path.resolve(archivePath);
console.log(`Profiling listPages against ${resolved}\n`);

const manager = new ArchiveManager();
const opened = await manager.open(resolved);
const knex = opened.accessor.getKnex();

try {
	// 1. Table size baseline.
	const totalRowsResult = await knex('pages').count('id as total');
	const totalRows = Number(totalRowsResult[0]?.total ?? 0);
	const baseFilterResult = await knex('pages')
		.where('scraped', 1)
		.whereNull('redirectDestId')
		.where((qb) => qb.whereNull('contentType').orWhere('contentType', 'text/html'))
		.count('id as total');
	const baseFilterRows = Number(baseFilterResult[0]?.total ?? 0);
	console.log(
		`pages table: ${totalRows.toLocaleString()} rows total, ${baseFilterRows.toLocaleString()} match the default Pages-view filter\n`,
	);

	// 2. EXPLAIN QUERY PLAN for COUNT.
	console.log('— EXPLAIN QUERY PLAN: COUNT(*) on default filter —');
	const explainCount = await knex.raw(
		`EXPLAIN QUERY PLAN
		 SELECT count(id) AS total FROM pages
		 WHERE scraped = 1 AND redirectDestId IS NULL
		 AND (contentType IS NULL OR contentType = 'text/html')`,
	);
	for (const row of explainCount) {
		console.log(`  ${row.detail}`);
	}

	// 3. EXPLAIN QUERY PLAN for SELECT.
	console.log('\n— EXPLAIN QUERY PLAN: SELECT ... ORDER BY url LIMIT/OFFSET —');
	const explainSelect = await knex.raw(
		`EXPLAIN QUERY PLAN
		 SELECT id, url, title, status FROM pages
		 WHERE scraped = 1 AND redirectDestId IS NULL
		 AND (contentType IS NULL OR contentType = 'text/html')
		 ORDER BY url ASC LIMIT 100 OFFSET 0`,
	);
	for (const row of explainSelect) {
		console.log(`  ${row.detail}`);
	}

	// 4. Timing matrix.
	const matrix = [
		{ limit: 50, offset: 0 },
		{ limit: 100, offset: 0 },
		{ limit: 100, offset: 100 },
		{ limit: 100, offset: 1000 },
		{ limit: 100, offset: 10_000 },
		{ limit: 200, offset: 0 },
	];

	console.log('\n— Wall-clock timings —');
	console.log('limit  offset    COUNT     SELECT    TOTAL');
	for (const { limit, offset } of matrix) {
		if (offset >= baseFilterRows) {
			console.log(
				`${String(limit).padStart(5)}  ${String(offset).padStart(7)}    (skipped — beyond baseFilterRows)`,
			);
			continue;
		}
		const countStart = process.hrtime.bigint();
		const countResult = await knex('pages')
			.where('scraped', 1)
			.whereNull('redirectDestId')
			.where((qb) => qb.whereNull('contentType').orWhere('contentType', 'text/html'))
			.count('id as total');
		const countMs = Number(process.hrtime.bigint() - countStart) / 1e6;
		void countResult;

		const selectStart = process.hrtime.bigint();
		const selectResult = await knex('pages')
			.where('scraped', 1)
			.whereNull('redirectDestId')
			.where((qb) => qb.whereNull('contentType').orWhere('contentType', 'text/html'))
			.select('id', 'url', 'title', 'status', 'lang', 'description')
			.orderBy('url', 'asc')
			.limit(limit)
			.offset(offset);
		const selectMs = Number(process.hrtime.bigint() - selectStart) / 1e6;
		void selectResult;

		console.log(
			`${String(limit).padStart(5)}  ${String(offset).padStart(7)}  ${`${countMs.toFixed(1)}ms`.padStart(8)}  ${`${selectMs.toFixed(1)}ms`.padStart(8)}  ${`${(countMs + selectMs).toFixed(1)}ms`.padStart(8)}`,
		);
	}

	console.log('\nDone. Share the output above to pick the right backend optimisation:');
	console.log(
		'- COUNT dominating (> 50% of total) → option B (COUNT skip / cache) buys most.',
	);
	console.log(
		'- SELECT dominating at deep offset → option A (partial index for ORDER BY url) buys most.',
	);
	console.log(
		'- Both fast (< 100ms each) but viewer is slow → bottleneck is elsewhere (network / render).',
	);
} finally {
	await manager.closeAll();
}
