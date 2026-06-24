#!/usr/bin/env node
/**
 * Bench `findDuplicates` SQL rewrite (Phase A of the SQL-first viewer
 * queries plan). Compares:
 *
 * - **BEFORE**: current N+1 pattern — one `GROUP BY title HAVING count > 1`
 *   query, then N `SELECT url WHERE title = ?` follow-up queries.
 * - **AFTER**: single-query `GROUP_CONCAT(url, X'1F') GROUP BY title` with
 *   a partial index `idx_pages_title_dedupe`.
 *
 * Also re-runs the four regression-candidate queries (listPages baseline,
 * listLinks broken, getLinkGraph edges, listPageLinks) so any planner
 * regression from the new partial index surfaces immediately.
 *
 * USAGE
 * -----
 *
 *     node scripts/bench-find-duplicates.mjs <archive.nitpicker>
 *
 * The archive is extracted to a temp dir (NEVER modified). The bench
 * applies `idx_pages_listfilter` (PR #96) and the new
 * `idx_pages_title_dedupe` to the temp DB before measuring the AFTER pass.
 * NEVER runs `ANALYZE` — the listfilter invariant.
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
	console.error('Usage: node scripts/bench-find-duplicates.mjs <archive.nitpicker>');
	process.exit(1);
}

const workDir = path.join(tmpdir(), `nitpicker-bench-dup-${process.pid}`);
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
 * Runs the BEFORE (N+1) find-duplicates SQL against `db` and returns the
 * wall-clock duration + result row count.
 * @returns {Promise<{ms: number, groups: number}>} Timing summary.
 */
async function runBeforeFindDuplicates() {
	const start = process.hrtime.bigint();
	const duplicateValues = await db('pages')
		.select('title')
		.count('id as cnt')
		.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
		.whereNull('redirectDestId')
		.whereNotNull('title')
		.whereNot('title', '')
		.groupBy('title')
		.having('cnt', '>', 1)
		.orderBy('cnt', 'desc')
		.limit(50);
	for (const row of duplicateValues) {
		await db('pages')
			.select('url')
			.where({ title: row.title, scraped: 1, isExternal: 0 })
			.whereNull('redirectDestId');
	}
	const ms = Number(process.hrtime.bigint() - start) / 1e6;
	return { ms, groups: duplicateValues.length };
}

/**
 * Runs the AFTER (GROUP_CONCAT) find-duplicates SQL against `db`.
 * Uses ASCII Unit Separator (X'1F') as the join delimiter so split is
 * unambiguous even when URLs contain commas / pipes / etc.
 * @returns {Promise<{ms: number, groups: number}>} Timing summary.
 */
async function runAfterFindDuplicates() {
	const start = process.hrtime.bigint();
	const rows = await db.raw(
		`SELECT title AS value,
		        COUNT(*) AS cnt,
		        GROUP_CONCAT(url, X'1F') AS urls
		   FROM pages
		  WHERE scraped = 1
		    AND isExternal = 0
		    AND contentType = 'text/html'
		    AND redirectDestId IS NULL
		    AND title IS NOT NULL
		    AND title != ''
		  GROUP BY title
		 HAVING cnt > 1
		  ORDER BY cnt DESC
		  LIMIT 50`,
	);
	// Equivalent of the eventual JS split — done here so the bench includes
	// the realistic JS work too.
	for (const row of rows) {
		void row.urls.split('');
	}
	const ms = Number(process.hrtime.bigint() - start) / 1e6;
	return { ms, groups: rows.length };
}

/**
 * Prints `EXPLAIN QUERY PLAN` for both passes — helps confirm that the
 * partial index gets picked up by the planner without ANALYZE.
 */
async function dumpPlans() {
	console.log('\n— EXPLAIN BEFORE (N+1 GROUP BY) —');
	const planBefore = await db.raw(
		`EXPLAIN QUERY PLAN
		 SELECT title, count(id) AS cnt FROM pages
		  WHERE scraped=1 AND isExternal=0 AND contentType='text/html'
		    AND redirectDestId IS NULL AND title IS NOT NULL AND title <> ''
		  GROUP BY title HAVING cnt > 1
		  ORDER BY cnt DESC LIMIT 50`,
	);
	for (const row of planBefore) console.log(`  ${row.detail}`);

	console.log('\n— EXPLAIN AFTER (GROUP_CONCAT) —');
	const planAfter = await db.raw(
		`EXPLAIN QUERY PLAN
		 SELECT title AS value, count(*) AS cnt, GROUP_CONCAT(url, X'1F') AS urls
		   FROM pages
		  WHERE scraped=1 AND isExternal=0 AND contentType='text/html'
		    AND redirectDestId IS NULL AND title IS NOT NULL AND title <> ''
		  GROUP BY title HAVING cnt > 1
		  ORDER BY cnt DESC LIMIT 50`,
	);
	for (const row of planAfter) console.log(`  ${row.detail}`);
}

/**
 * Runs the 4 regression-candidate queries and returns their timings.
 * Identical shapes to `scripts/bench-partial-listfilter.mjs` so the
 * timings are directly comparable.
 * @param {string} label - Pass label.
 */
async function runRegressionCheck(label) {
	console.log(`\n— Regression check: ${label} —`);
	const cases = [
		[
			'listPages',
			`SELECT id, url, title FROM pages
			  WHERE scraped=1 AND redirectDestId IS NULL
			    AND (contentType IS NULL OR contentType='text/html')
			  ORDER BY url LIMIT 100`,
		],
		[
			'listLinks broken',
			`SELECT anchors.id FROM anchors
			  JOIN pages AS source ON anchors.pageId = source.id
			  JOIN pages AS dest ON anchors.hrefId = dest.id
			  LEFT JOIN pages AS canonical ON dest.redirectDestId = canonical.id
			  WHERE COALESCE(canonical.status, dest.status) >= 400
			     OR COALESCE(canonical.status, dest.status) IS NULL
			  LIMIT 100`,
		],
		[
			'getLinkGraph edges',
			`SELECT DISTINCT source.url, dest.url FROM anchors
			  JOIN pages AS source ON anchors.pageId = source.id
			  JOIN pages AS dest ON anchors.hrefId = dest.id
			  WHERE source.isExternal=0 AND source.scraped=1 AND source.contentType='text/html'
			    AND source.redirectDestId IS NULL
			    AND dest.isExternal=0 AND dest.scraped=1 AND dest.contentType='text/html'
			    AND dest.redirectDestId IS NULL
			    AND anchors.pageId != anchors.hrefId
			  LIMIT 100`,
		],
		[
			'listPageLinks',
			`SELECT id, url FROM pages WHERE redirectDestId IS NULL ORDER BY url LIMIT 100`,
		],
	];
	for (const [name, sql] of cases) {
		const start = process.hrtime.bigint();
		await db.raw(sql);
		const ms = Number(process.hrtime.bigint() - start) / 1e6;
		console.log(`  ${ms.toFixed(0).padStart(8)}ms  ${name}`);
	}
}

try {
	// Step 1: apply the listfilter index (PR #96) so the BEFORE baseline
	// matches what users on `dev` see after that PR. The bench archive may
	// pre-date that index.
	console.log('\n[1] CREATE INDEX idx_pages_listfilter (if missing)');
	const t1 = process.hrtime.bigint();
	await db.raw(
		`CREATE INDEX IF NOT EXISTS idx_pages_listfilter
		 ON pages(isExternal, scraped, redirectDestId, url, contentType)`,
	);
	console.log(`    ${(Number(process.hrtime.bigint() - t1) / 1e6).toFixed(0)}ms`);

	await runRegressionCheck('BEFORE (only listfilter)');

	console.log('\n[2] BEFORE find-duplicates (N+1 pattern)');
	const before = await runBeforeFindDuplicates();
	console.log(`    ${before.ms.toFixed(0)}ms (${before.groups} groups)`);

	// Step 3: add the partial title-dedupe index.
	console.log('\n[3] CREATE INDEX idx_pages_title_dedupe');
	const t3 = process.hrtime.bigint();
	await db.raw(
		`CREATE INDEX IF NOT EXISTS idx_pages_title_dedupe
		 ON pages(title)
		 WHERE scraped = 1
		   AND isExternal = 0
		   AND contentType = 'text/html'
		   AND redirectDestId IS NULL
		   AND title IS NOT NULL
		   AND title != ''`,
	);
	console.log(`    ${(Number(process.hrtime.bigint() - t3) / 1e6).toFixed(0)}ms`);

	console.log('\n[4] AFTER find-duplicates (GROUP_CONCAT + partial index)');
	const after = await runAfterFindDuplicates();
	console.log(`    ${after.ms.toFixed(0)}ms (${after.groups} groups)`);

	await dumpPlans();
	await runRegressionCheck('AFTER (listfilter + title-dedupe)');

	console.log(`\n— Summary —`);
	console.log(`  BEFORE (N+1):        ${before.ms.toFixed(0)}ms`);
	console.log(`  AFTER  (GROUP_CONCAT): ${after.ms.toFixed(0)}ms`);
	console.log(`  speedup: ${(before.ms / Math.max(after.ms, 1)).toFixed(1)}x`);
	console.log(`  group counts match: ${before.groups === after.groups ? 'YES' : 'NO ⚠'}`);
} finally {
	await db.destroy();
	rmSync(workDir, { recursive: true, force: true });
}
console.log('\nDone.');
