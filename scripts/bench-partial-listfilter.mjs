#!/usr/bin/env node
/**
 * Targeted bench: does a **partial** `pages` listfilter index avoid the
 * `getLinkGraph` / `listLinks` regression that the broader composite index
 * triggered, while keeping the `listPages` win?
 *
 * Runs just the four cases that matter — listPages (win), listLinks broken
 * (regression candidate), getLinkGraph (regression candidate), listPageLinks
 * (unchanged) — before and after the partial index, with and without
 * ANALYZE. Prints EXPLAIN QUERY PLAN for each shape so we see what the
 * planner actually picked.
 *
 * USAGE
 * -----
 *
 *     node scripts/bench-partial-listfilter.mjs <archive.nitpicker>
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { getLinkGraph, listLinks, listPageLinks, listPages } from '@nitpicker/query';
import knex from 'knex';
import * as tar from 'tar';

import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';

const archivePath = process.argv[2];
if (!archivePath) {
	console.error('Usage: node scripts/bench-partial-listfilter.mjs <archive.nitpicker>');
	process.exit(1);
}

const workDir = path.join(tmpdir(), `nitpicker-bench-partial-${process.pid}`);
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

const accessor = { getKnex: () => db };

const CASES = [
	['listPages offset0', () => listPages(accessor, { limit: 100, offset: 0 })],
	[
		'listLinks broken',
		() => listLinks(accessor, { type: 'broken', limit: 100, offset: 0 }),
	],
	['getLinkGraph', () => getLinkGraph(accessor)],
	['listPageLinks', () => listPageLinks(accessor, { limit: 100, offset: 0 })],
];

/**
 * Print EXPLAIN QUERY PLAN for a representative SQL shape from each path.
 * @param {string} label - Heading label.
 */
async function dumpPlans(label) {
	console.log(`\n— EXPLAIN ${label} —`);
	const plans = [
		[
			'listPages SELECT',
			`SELECT id, url, title FROM pages
			 WHERE scraped=1 AND redirectDestId IS NULL
			 AND (contentType IS NULL OR contentType='text/html')
			 ORDER BY url LIMIT 100`,
		],
		[
			'listLinks broken JOIN',
			`SELECT anchors.id FROM anchors
			 JOIN pages AS source ON anchors.pageId=source.id
			 JOIN pages AS dest ON anchors.hrefId=dest.id
			 LEFT JOIN pages AS canonical ON dest.redirectDestId=canonical.id
			 WHERE COALESCE(canonical.status, dest.status) >= 400
				OR COALESCE(canonical.status, dest.status) IS NULL
			 LIMIT 100`,
		],
		[
			'getLinkGraph edges',
			`SELECT DISTINCT source.url, dest.url FROM anchors
			 JOIN pages AS source ON anchors.pageId=source.id
			 JOIN pages AS dest ON anchors.hrefId=dest.id
			 WHERE source.isExternal=0 AND source.scraped=1 AND source.contentType='text/html'
			 AND source.redirectDestId IS NULL
			 AND dest.isExternal=0 AND dest.scraped=1 AND dest.contentType='text/html'
			 AND dest.redirectDestId IS NULL
			 AND anchors.pageId != anchors.hrefId`,
		],
	];
	for (const [name, sql] of plans) {
		console.log(`  ${name}:`);
		const rows = await db.raw(`EXPLAIN QUERY PLAN ${sql}`);
		for (const row of rows) console.log(`    ${row.detail}`);
	}
}

/**
 * Runs the 4 bench cases and returns timings.
 * @param {string} label - Pass label.
 * @returns {Promise<Record<string, number>>} Case name → ms.
 */
async function runPass(label) {
	console.log(`\n══════════ ${label} ══════════`);
	const out = {};
	for (const [name, fn] of CASES) {
		const start = process.hrtime.bigint();
		try {
			await fn();
			const ms = Number(process.hrtime.bigint() - start) / 1e6;
			out[name] = ms;
			console.log(`  ${ms.toFixed(0).padStart(8)}ms  ${name}`);
		} catch (error) {
			console.log(`  ERR  ${name}  ${error?.message ?? error}`);
			out[name] = Number.NaN;
		}
	}
	return out;
}

try {
	const baseline = await runPass('BASELINE');
	await dumpPlans('BASELINE');

	console.log('\n— CREATE composite covering index, no ANALYZE —');
	const start1 = process.hrtime.bigint();
	await db.raw(
		`CREATE INDEX idx_pages_listfilter ON pages(isExternal, scraped, redirectDestId, url, contentType)`,
	);
	console.log(
		`  index built in ${(Number(process.hrtime.bigint() - start1) / 1e6).toFixed(0)}ms`,
	);

	const afterNoAnalyze = await runPass('WITH composite index, NO ANALYZE');
	await dumpPlans('WITH composite index, NO ANALYZE');

	console.log('\n— ANALYZE —');
	const start2 = process.hrtime.bigint();
	await db.raw('ANALYZE');
	console.log(
		`  done in ${(Number(process.hrtime.bigint() - start2) / 1e6).toFixed(0)}ms`,
	);

	const afterAnalyze = await runPass('WITH composite index + ANALYZE');
	await dumpPlans('WITH composite index + ANALYZE');

	console.log('\n— Speedup table —');
	console.log('  baseline   no-ANALYZE     w/ANALYZE  query');
	for (const [name] of CASES) {
		const b = baseline[name];
		const na = afterNoAnalyze[name];
		const a = afterAnalyze[name];
		const fmt = (v) => `${v.toFixed(0)}ms`.padStart(10);
		console.log(`  ${fmt(b)}  ${fmt(na)}  ${fmt(a)}  ${name}`);
	}
} finally {
	await db.destroy();
	rmSync(workDir, { recursive: true, force: true });
}
console.log('\nDone.');
