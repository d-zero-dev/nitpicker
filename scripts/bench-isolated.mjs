#!/usr/bin/env node
/**
 * Phase E bench: decompose `computeIsolatedClusters` so we see whether the
 * 15-17s cost on the bench archive lives in:
 *
 * 1. The `pageRows` query (inventory-* HTML filter on `pages.source`)
 * 2. The `redirectRows` query (all redirect-source rows)
 * 3. The chunked `anchorRows` query (anchors whose source is a candidate)
 * 4. The JS union-find + group + sort
 *
 * Then probe whether a partial index on `pages.source` for inventory-*
 * filtering helps the first query (the existing single-column index may
 * not be selective enough).
 *
 * USAGE
 * -----
 *
 *     node scripts/bench-isolated.mjs <archive.nitpicker>
 *
 * NEVER runs `ANALYZE`.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import knex from 'knex';
import * as tar from 'tar';

import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';

const archivePath = process.argv[2];
if (!archivePath) {
	console.error('Usage: node scripts/bench-isolated.mjs <archive.nitpicker>');
	process.exit(1);
}

const workDir = path.join(tmpdir(), `nitpicker-bench-iso-${process.pid}`);
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
console.log(`Untarring to ${workDir} ...`);
await tar.x({ file: path.resolve(archivePath), cwd: workDir });
const innerDirs = readdirSync(workDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && !entry.name.startsWith('._'))
	.map((entry) => entry.name);
const dbPath = path.join(workDir, innerDirs[0], 'db.sqlite');

const db = knex({
	client: LibsqlDialect,
	connection: { filename: dbPath },
	useNullAsDefault: true,
});

/**
 * Decomposes computeIsolatedClusters into its four stages.
 */
async function decompose() {
	const t1 = process.hrtime.bigint();
	const pageRows = await db.raw(
		`SELECT id, url, title, status, source FROM pages
		  WHERE scraped = 1
		    AND isExternal = 0
		    AND contentType = 'text/html'
		    AND source IN ('inventory-seed', 'inventory-discovered')
		    AND redirectDestId IS NULL`,
	);
	const pageRowsMs = Number(process.hrtime.bigint() - t1) / 1e6;
	console.log(`  pageRows query: ${pageRowsMs.toFixed(0)}ms (${pageRows.length} rows)`);

	const t2 = process.hrtime.bigint();
	const redirectRows = await db.raw(
		`SELECT id, redirectDestId FROM pages WHERE redirectDestId IS NOT NULL`,
	);
	const redirectRowsMs = Number(process.hrtime.bigint() - t2) / 1e6;
	console.log(
		`  redirectRows query: ${redirectRowsMs.toFixed(0)}ms (${redirectRows.length} rows)`,
	);

	const t3 = process.hrtime.bigint();
	const ids = pageRows.map((r) => r.id);
	const anchorRows = [];
	const CHUNK = 500;
	for (let i = 0; i < ids.length; i += CHUNK) {
		const chunk = ids.slice(i, i + CHUNK);
		if (chunk.length === 0) continue;
		const placeholders = chunk.map(() => '?').join(',');
		const rows = await db.raw(
			`SELECT pageId, hrefId FROM anchors WHERE pageId IN (${placeholders})`,
			chunk,
		);
		anchorRows.push(...rows);
	}
	const anchorRowsMs = Number(process.hrtime.bigint() - t3) / 1e6;
	console.log(
		`  anchorRows query: ${anchorRowsMs.toFixed(0)}ms (${anchorRows.length} rows)`,
	);

	const total = pageRowsMs + redirectRowsMs + anchorRowsMs;
	console.log(`  SQL total:        ${total.toFixed(0)}ms`);
	return {
		pageRowsCount: pageRows.length,
		redirectCount: redirectRows.length,
		anchorCount: anchorRows.length,
		total,
	};
}

/**
 * EXPLAIN the three queries.
 * @param label
 */
async function dumpPlans(label) {
	console.log(`\n— EXPLAIN ${label} —`);
	const p1 = await db.raw(
		`EXPLAIN QUERY PLAN
		 SELECT id, url FROM pages WHERE scraped=1 AND isExternal=0
		   AND contentType='text/html' AND source IN ('inventory-seed', 'inventory-discovered')
		   AND redirectDestId IS NULL`,
	);
	console.log(`  pageRows:`);
	for (const r of p1) console.log(`    ${r.detail}`);
	const p2 = await db.raw(
		`EXPLAIN QUERY PLAN
		 SELECT id, redirectDestId FROM pages WHERE redirectDestId IS NOT NULL`,
	);
	console.log(`  redirectRows:`);
	for (const r of p2) console.log(`    ${r.detail}`);
}

/**
 *
 * @param label
 */
async function regression(label) {
	console.log(`\n— Regression: ${label} —`);
	const cases = [
		[
			'listPages',
			`SELECT id, url FROM pages
			  WHERE scraped=1 AND redirectDestId IS NULL
			    AND (contentType IS NULL OR contentType='text/html')
			  ORDER BY url LIMIT 100`,
		],
		[
			'listLinks broken',
			`SELECT anchors.id FROM anchors
			  JOIN pages AS source ON anchors.pageId=source.id
			  JOIN pages AS dest ON anchors.hrefId=dest.id
			  LEFT JOIN pages AS canonical ON dest.redirectDestId=canonical.id
			  WHERE COALESCE(canonical.status, dest.status) >= 400
			     OR COALESCE(canonical.status, dest.status) IS NULL
			  LIMIT 100`,
		],
		[
			'listPageLinks',
			`SELECT id, url FROM pages WHERE redirectDestId IS NULL ORDER BY url LIMIT 100`,
		],
	];
	for (const [name, sql] of cases) {
		const t = process.hrtime.bigint();
		await db.raw(sql);
		console.log(
			`  ${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(0).padStart(7)}ms  ${name}`,
		);
	}
}

try {
	console.log('\n[1] Ensure idx_pages_listfilter (PR #96 baseline)');
	await db.raw(
		`CREATE INDEX IF NOT EXISTS idx_pages_listfilter
		 ON pages(scraped, redirectDestId, url, contentType)`,
	);

	console.log('\n[2] BASELINE decompose');
	const baseline = await decompose();
	await dumpPlans('BASELINE');
	await regression('BASELINE');

	console.log('\n[3] SQL-side candidate filter: anchors as a single JOIN');
	// Same algorithm but everything in one SQL: candidates CTE +
	// LEFT JOIN redirect_map for 1-hop resolution + filter to internal edges.
	const t3 = process.hrtime.bigint();
	const edges = await db.raw(
		`WITH candidates AS (
		   SELECT id FROM pages
		     WHERE source IN ('inventory-seed', 'inventory-discovered')
		       AND scraped = 1
		       AND isExternal = 0
		       AND contentType = 'text/html'
		       AND redirectDestId IS NULL
		 ),
		 redirect_map AS (
		   SELECT id, redirectDestId FROM pages WHERE redirectDestId IS NOT NULL
		 )
		 SELECT a.pageId AS source_id,
		        COALESCE(rm.redirectDestId, a.hrefId) AS dest_id
		   FROM anchors a
		   JOIN candidates s ON a.pageId = s.id
		   LEFT JOIN redirect_map rm ON a.hrefId = rm.id
		   JOIN candidates d ON COALESCE(rm.redirectDestId, a.hrefId) = d.id
		  WHERE a.pageId != COALESCE(rm.redirectDestId, a.hrefId)`,
	);
	const sqlSideMs = Number(process.hrtime.bigint() - t3) / 1e6;
	console.log(
		`  edges in SQL-side filter: ${sqlSideMs.toFixed(0)}ms (${edges.length} edges)`,
	);

	console.log('\n[4] Replan: 1-query path (skip the JS round trip)');
	const t4 = process.hrtime.bigint();
	const [pages2, edges2] = await Promise.all([
		db.raw(
			`SELECT id, url, title, status, source FROM pages
			  WHERE source IN ('inventory-seed', 'inventory-discovered')
			    AND scraped=1 AND isExternal=0 AND contentType='text/html'
			    AND redirectDestId IS NULL`,
		),
		db.raw(
			`WITH candidates AS (
			   SELECT id FROM pages
			     WHERE source IN ('inventory-seed', 'inventory-discovered')
			       AND scraped=1 AND isExternal=0 AND contentType='text/html'
			       AND redirectDestId IS NULL
			 ),
			 redirect_map AS (
			   SELECT id, redirectDestId FROM pages WHERE redirectDestId IS NOT NULL
			 )
			 SELECT a.pageId AS source_id,
			        COALESCE(rm.redirectDestId, a.hrefId) AS dest_id
			   FROM anchors a
			   JOIN candidates s ON a.pageId = s.id
			   LEFT JOIN redirect_map rm ON a.hrefId = rm.id
			   JOIN candidates d ON COALESCE(rm.redirectDestId, a.hrefId) = d.id
			  WHERE a.pageId != COALESCE(rm.redirectDestId, a.hrefId)`,
		),
	]);
	void pages2;
	void edges2;
	const parallelMs = Number(process.hrtime.bigint() - t4) / 1e6;
	console.log(`  parallel-fetch total: ${parallelMs.toFixed(0)}ms`);

	await regression('AFTER');

	console.log('\n— Summary —');
	console.log(`  Current pipeline: ${baseline.total.toFixed(0)}ms`);
	console.log(`  SQL-side filter:  ${sqlSideMs.toFixed(0)}ms (edge-only)`);
	console.log(`  Parallel pages + edges: ${parallelMs.toFixed(0)}ms`);
} finally {
	await db.destroy();
	rmSync(workDir, { recursive: true, force: true });
}
console.log('\nDone.');
