#!/usr/bin/env node
/**
 * Phase B bench: decompose `getLinkGraph` so we see whether the 33s cost is
 * dominated by `pageRows` fetch / `edgeRows` fetch / JS `inDegree` Map / JS
 * `toSorted` slice. Then try a SQL push-down variant that computes
 * `inDegree` and top-K nodes inside SQL.
 *
 * Also runs the 4 regression-candidate queries before / after applying any
 * new index, per the SQL-first plan invariant.
 *
 * USAGE
 * -----
 *
 *     node scripts/bench-get-link-graph.mjs <archive.nitpicker>
 *
 * NEVER runs `ANALYZE` — the `idx_pages_listfilter` invariant.
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
	console.error('Usage: node scripts/bench-get-link-graph.mjs <archive.nitpicker>');
	process.exit(1);
}

const workDir = path.join(tmpdir(), `nitpicker-bench-graph-${process.pid}`);
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

const INTERNAL_WHERE = (alias) => `
	${alias}.isExternal = 0
	AND ${alias}.scraped = 1
	AND ${alias}.contentType = 'text/html'
	AND ${alias}.redirectDestId IS NULL`;

/**
 * Decomposes the current implementation: separately times pageRows fetch,
 * edgeRows fetch, JS inDegree aggregation, JS sort+slice (if limited).
 * @param {number|null} limit - Optional cap.
 */
async function decomposeCurrent(limit) {
	const result = {};
	const t1 = process.hrtime.bigint();
	const pageRows = await db.raw(
		`SELECT url, status FROM pages WHERE ${INTERNAL_WHERE('pages')}`,
	);
	result.pageRowsMs = Number(process.hrtime.bigint() - t1) / 1e6;
	result.pageRowsCount = pageRows.length;

	const t2 = process.hrtime.bigint();
	const edgeRows = await db.raw(
		`SELECT DISTINCT source.url AS source, dest.url AS target
		   FROM anchors
		   JOIN pages AS source ON anchors.pageId = source.id
		   JOIN pages AS dest ON anchors.hrefId = dest.id
		  WHERE ${INTERNAL_WHERE('source')}
		    AND ${INTERNAL_WHERE('dest')}
		    AND anchors.pageId != anchors.hrefId`,
	);
	result.edgeRowsMs = Number(process.hrtime.bigint() - t2) / 1e6;
	result.edgeRowsCount = edgeRows.length;

	const t3 = process.hrtime.bigint();
	const inDegree = new Map();
	for (const edge of edgeRows) {
		inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
	}
	let nodes = pageRows.map((row) => ({
		url: row.url,
		status: row.status,
		inDegree: inDegree.get(row.url) ?? 0,
	}));
	let edges = edgeRows;
	if (limit != null && nodes.length > limit) {
		nodes = nodes.toSorted((a, b) => b.inDegree - a.inDegree).slice(0, limit);
		const kept = new Set(nodes.map((n) => n.url));
		edges = edges.filter((e) => kept.has(e.source) && kept.has(e.target));
	}
	result.jsMs = Number(process.hrtime.bigint() - t3) / 1e6;
	result.nodesOut = nodes.length;
	result.edgesOut = edges.length;
	result.totalMs = result.pageRowsMs + result.edgeRowsMs + result.jsMs;
	return result;
}

// NOTE: the `sqlPushDown` variant (LEFT JOIN aggregate subquery to compute
// inDegree inside SQL) was earlier benchmarked here and found to be ~10x
// slower than the current JS-Map aggregation (~388s vs ~38s on the 428k
// archive). The body is removed to keep this script lean; the bench-only
// comparison lives in PR #96's bench-partial-listfilter.mjs and in the
// get-link-graph.ts JSDoc.

/**
 * Variant: same algorithm as current, but the edge query returns integer
 * IDs instead of source/dest URL strings. URLs are resolved in JS using
 * the already-fetched pageRows. Saves the 2 JOINs in the heavy 6M-row
 * edge query.
 * @param {number|null} limit - Optional cap.
 */
async function edgesAsIds(limit) {
	const result = {};
	const t1 = process.hrtime.bigint();
	const pageRows = await db.raw(
		`SELECT id, url, status FROM pages WHERE ${INTERNAL_WHERE('pages')}`,
	);
	result.pageRowsMs = Number(process.hrtime.bigint() - t1) / 1e6;
	result.pageRowsCount = pageRows.length;
	const urlById = new Map(pageRows.map((r) => [r.id, r.url]));
	const internalIds = new Set(pageRows.map((r) => r.id));

	// Edges as integer IDs — no JOIN. Filter to internal pages via
	// `IN (subquery)`. SQLite rewrites these as semijoins / lookups.
	const t2 = process.hrtime.bigint();
	const edgeRows = await db.raw(
		`SELECT DISTINCT pageId AS sourceId, hrefId AS destId
		   FROM anchors
		  WHERE pageId != hrefId
		    AND pageId IN (
		      SELECT id FROM pages WHERE ${INTERNAL_WHERE('pages')}
		    )
		    AND hrefId IN (
		      SELECT id FROM pages WHERE ${INTERNAL_WHERE('pages')}
		    )`,
	);
	result.edgeRowsMs = Number(process.hrtime.bigint() - t2) / 1e6;
	result.edgeRowsCount = edgeRows.length;

	const t3 = process.hrtime.bigint();
	const inDegree = new Map();
	for (const edge of edgeRows) {
		inDegree.set(edge.destId, (inDegree.get(edge.destId) ?? 0) + 1);
	}
	let nodes = pageRows.map((row) => ({
		url: row.url,
		status: row.status,
		inDegree: inDegree.get(row.id) ?? 0,
	}));
	let edges = edgeRows.map((e) => ({
		source: urlById.get(e.sourceId),
		target: urlById.get(e.destId),
	}));
	if (limit != null && nodes.length > limit) {
		nodes = nodes.toSorted((a, b) => b.inDegree - a.inDegree).slice(0, limit);
		const kept = new Set(nodes.map((n) => n.url));
		edges = edges.filter((e) => kept.has(e.source) && kept.has(e.target));
	}
	result.jsMs = Number(process.hrtime.bigint() - t3) / 1e6;
	result.nodesOut = nodes.length;
	result.edgesOut = edges.length;
	result.totalMs = result.pageRowsMs + result.edgeRowsMs + result.jsMs;
	void internalIds; // silence lint
	return result;
}

/**
 * Regression check — the 4 sentinel queries from the SQL-first plan.
 * @param {string} label - Pass label.
 */
async function regression(label) {
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
		 ON pages(isExternal, scraped, redirectDestId, url, contentType)`,
	);

	await regression('BEFORE Phase B');

	console.log('\n[2] Decompose CURRENT getLinkGraph (no limit)');
	const noLimit = await decomposeCurrent(null);
	console.log(
		`    pageRows: ${noLimit.pageRowsMs.toFixed(0)}ms (${noLimit.pageRowsCount} rows)`,
	);
	console.log(
		`    edgeRows: ${noLimit.edgeRowsMs.toFixed(0)}ms (${noLimit.edgeRowsCount} rows)`,
	);
	console.log(`    JS agg:   ${noLimit.jsMs.toFixed(0)}ms`);
	console.log(`    TOTAL:    ${noLimit.totalMs.toFixed(0)}ms`);

	console.log('\n[3] Decompose CURRENT getLinkGraph (limit=500)');
	const lim500 = await decomposeCurrent(500);
	console.log(`    pageRows: ${lim500.pageRowsMs.toFixed(0)}ms`);
	console.log(`    edgeRows: ${lim500.edgeRowsMs.toFixed(0)}ms`);
	console.log(`    JS agg:   ${lim500.jsMs.toFixed(0)}ms`);
	console.log(`    TOTAL:    ${lim500.totalMs.toFixed(0)}ms`);

	console.log(
		'\n[4] edgesAsIds variant (no limit) — fetch integer IDs, resolve URLs in JS',
	);
	const idsNoLimit = await edgesAsIds(null);
	console.log(`    pageRows:  ${idsNoLimit.pageRowsMs.toFixed(0)}ms`);
	console.log(
		`    edgeRows:  ${idsNoLimit.edgeRowsMs.toFixed(0)}ms (${idsNoLimit.edgeRowsCount} rows)`,
	);
	console.log(`    JS:        ${idsNoLimit.jsMs.toFixed(0)}ms`);
	console.log(`    TOTAL:     ${idsNoLimit.totalMs.toFixed(0)}ms`);

	console.log('\n[5] edgesAsIds variant (limit=500)');
	const idsLim500 = await edgesAsIds(500);
	console.log(`    pageRows:  ${idsLim500.pageRowsMs.toFixed(0)}ms`);
	console.log(`    edgeRows:  ${idsLim500.edgeRowsMs.toFixed(0)}ms`);
	console.log(`    JS:        ${idsLim500.jsMs.toFixed(0)}ms`);
	console.log(`    TOTAL:     ${idsLim500.totalMs.toFixed(0)}ms`);

	await regression('AFTER Phase B');

	console.log('\n— Summary —');
	console.log(`  No-limit current:    ${noLimit.totalMs.toFixed(0)}ms`);
	console.log(
		`  No-limit edgesAsIds: ${idsNoLimit.totalMs.toFixed(0)}ms (${(noLimit.totalMs / Math.max(idsNoLimit.totalMs, 1)).toFixed(1)}x)`,
	);
	console.log(`  Lim=500 current:     ${lim500.totalMs.toFixed(0)}ms`);
	console.log(
		`  Lim=500 edgesAsIds:  ${idsLim500.totalMs.toFixed(0)}ms (${(lim500.totalMs / Math.max(idsLim500.totalMs, 1)).toFixed(1)}x)`,
	);
} finally {
	await db.destroy();
	rmSync(workDir, { recursive: true, force: true });
}
console.log('\nDone.');
