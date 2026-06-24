#!/usr/bin/env node
/**
 * Measures the impact of adding a partial index for the default Pages-view
 * filter against a real `.nitpicker` archive. Extracts the archive into a
 * temp directory (the input file is NEVER modified), runs the bench
 * matrix without the index, adds the index, re-runs, then discards the
 * temp dir.
 *
 * USAGE
 * -----
 *
 *     node scripts/bench-with-partial-index.mjs <archive.nitpicker>
 *
 * Output is anonymous (timings + plans only); URLs / titles are not read.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import knex from 'knex';
import * as tar from 'tar';

import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';

const archivePath = process.argv[2];
if (!archivePath) {
	console.error('Usage: node scripts/bench-with-partial-index.mjs <archive.nitpicker>');
	process.exit(1);
}

const workDir = path.join(tmpdir(), `nitpicker-partial-index-${process.pid}`);
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
console.log(`Untarring to ${workDir} ...`);
await tar.x({ file: path.resolve(archivePath), cwd: workDir });

// Locate the inner directory created by the tar (single top-level entry).
const { readdirSync } = await import('node:fs');
const innerDirs = readdirSync(workDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && !entry.name.startsWith('._'))
	.map((entry) => entry.name);
if (innerDirs.length !== 1) {
	throw new Error(`Expected one inner dir, got: ${innerDirs.join(', ')}`);
}
const dbPath = path.join(workDir, innerDirs[0], 'db.sqlite');
console.log(`DB at ${dbPath}\n`);

const db = knex({
	client: LibsqlDialect,
	connection: { filename: dbPath },
	useNullAsDefault: true,
});

const MATRIX = [
	{ limit: 100, offset: 0 },
	{ limit: 100, offset: 100 },
	{ limit: 100, offset: 1000 },
	{ limit: 100, offset: 10_000 },
	{ limit: 100, offset: 50_000 },
];

/**
 * Runs one EXPLAIN + timing matrix. Returns nothing — prints to stdout.
 * @param {string} label - Header label for this pass.
 */
async function runPass(label) {
	console.log(`\n══════════ ${label} ══════════`);

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

	console.log('  limit  offset       COUNT      SELECT       TOTAL');
	for (const { limit, offset } of MATRIX) {
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

		console.log(
			`  ${String(limit).padStart(5)}  ${String(offset).padStart(8)}  ${`${countMs.toFixed(1)}ms`.padStart(10)}  ${`${selectMs.toFixed(1)}ms`.padStart(10)}  ${`${(countMs + selectMs).toFixed(1)}ms`.padStart(10)}`,
		);
	}
}

try {
	await runPass('WITHOUT partial index (baseline)');

	// Strategy: composite covering index with url adjacent to the equality
	// predicates so SQLite can satisfy both the WHERE filter AND the
	// `ORDER BY url ASC` from a single index-ordered scan, killing the
	// `USE TEMP B-TREE FOR ORDER BY` overhead at deep offsets.
	console.log(
		'\nCREATE INDEX idx_pages_listfilter ON pages(scraped, redirectDestId, url, contentType)',
	);
	const indexStart = process.hrtime.bigint();
	await db.raw(
		`CREATE INDEX idx_pages_listfilter ON pages(scraped, redirectDestId, url, contentType)`,
	);
	const indexMs = Number(process.hrtime.bigint() - indexStart) / 1e6;
	console.log(`  index built in ${indexMs.toFixed(0)}ms`);
	const analyzeStart = process.hrtime.bigint();
	await db.raw('ANALYZE pages');
	const analyzeMs = Number(process.hrtime.bigint() - analyzeStart) / 1e6;
	console.log(`  ANALYZE pages in ${analyzeMs.toFixed(0)}ms`);

	await runPass('WITH composite covering index + ANALYZE');
} finally {
	await db.destroy();
	rmSync(workDir, { recursive: true, force: true });
}
console.log('\nDone.');
