#!/usr/bin/env node
/**
 * Phase C+D bench: covering-index variants for `listUnusedResources` and
 * `listImages`. Both are SQL-bound — the JS post-processing is trivial
 * mapping. Each new index is validated against the 4 regression-sentinel
 * queries (listPages, listLinks broken, listPageLinks, getLinkGraph edge
 * head) to ensure ANALYZE-free planner heuristics still pick the right
 * path everywhere.
 *
 * USAGE
 * -----
 *
 *     node scripts/bench-unused-images.mjs <archive.nitpicker>
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
	console.error('Usage: node scripts/bench-unused-images.mjs <archive.nitpicker>');
	process.exit(1);
}

const workDir = path.join(tmpdir(), `nitpicker-bench-ui-${process.pid}`);
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
 * Runs the listUnusedResources query (raw SQL) and returns timing.
 * @returns {Promise<number>} Wall-clock ms.
 */
async function runUnusedResources() {
	const t = process.hrtime.bigint();
	await db.raw(
		`SELECT resources.id AS total
		   FROM resources
		   LEFT JOIN "resources-referrers"
		     ON resources.id = "resources-referrers".resourceId
		  WHERE "resources-referrers".id IS NULL
		    AND resources.isExternal = 0`,
	);
	await db.raw(
		`SELECT resources.url, resources.status, resources.contentType,
		        resources.contentLength, resources.source
		   FROM resources
		   LEFT JOIN "resources-referrers"
		     ON resources.id = "resources-referrers".resourceId
		  WHERE "resources-referrers".id IS NULL
		    AND resources.isExternal = 0
		  ORDER BY resources.url
		  LIMIT 100`,
	);
	return Number(process.hrtime.bigint() - t) / 1e6;
}

/**
 * Runs the listImages default query (no filters) and returns timing.
 * @returns {Promise<number>} Wall-clock ms.
 */
async function runImages() {
	const t = process.hrtime.bigint();
	await db.raw(
		`SELECT images.id AS total FROM images
		   JOIN pages ON images.pageId = pages.id`,
	);
	await db.raw(
		`SELECT pages.url AS pageUrl, images.src, images.alt,
		        images.width, images.height,
		        images.naturalWidth, images.naturalHeight, images.isLazy
		   FROM images
		   JOIN pages ON images.pageId = pages.id
		  ORDER BY pages.url
		  LIMIT 100`,
	);
	return Number(process.hrtime.bigint() - t) / 1e6;
}

/**
 * Explains both queries.
 * @param {string} label - Pass label.
 */
async function dumpPlans(label) {
	console.log(`\n— EXPLAIN ${label} —`);
	const u = await db.raw(
		`EXPLAIN QUERY PLAN
		 SELECT resources.url FROM resources
		   LEFT JOIN "resources-referrers"
		     ON resources.id = "resources-referrers".resourceId
		  WHERE "resources-referrers".id IS NULL
		    AND resources.isExternal = 0
		  ORDER BY resources.url LIMIT 100`,
	);
	console.log(`  listUnusedResources SELECT:`);
	for (const r of u) console.log(`    ${r.detail}`);
	const i = await db.raw(
		`EXPLAIN QUERY PLAN
		 SELECT pages.url, images.src FROM images
		   JOIN pages ON images.pageId = pages.id
		  ORDER BY pages.url LIMIT 100`,
	);
	console.log(`  listImages SELECT:`);
	for (const r of i) console.log(`    ${r.detail}`);
}

/**
 * Regression sentinel queries.
 * @param {string} label - Pass label.
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

	console.log('\n[2] BASELINE');
	const u0 = await runUnusedResources();
	const i0 = await runImages();
	console.log(`  listUnusedResources: ${u0.toFixed(0)}ms`);
	console.log(`  listImages:          ${i0.toFixed(0)}ms`);
	await dumpPlans('BASELINE');
	await regression('BASELINE');

	console.log('\n[3] Add idx_resources_internal_url(isExternal, url)');
	const t3 = process.hrtime.bigint();
	await db.raw(`CREATE INDEX idx_resources_internal_url ON resources(isExternal, url)`);
	console.log(`  built in ${(Number(process.hrtime.bigint() - t3) / 1e6).toFixed(0)}ms`);

	const u1 = await runUnusedResources();
	console.log(
		`  listUnusedResources: ${u1.toFixed(0)}ms (was ${u0.toFixed(0)}ms, ${(u0 / Math.max(u1, 1)).toFixed(1)}x)`,
	);

	console.log(
		'\n[4] Add idx_images_pageId_id(pageId, id) — already exists as pageId, try widening',
	);
	// `images(pageId)` already exists. Try a covering index ordered by
	// pages.url isn't directly possible (cross-table). The natural improvement
	// is making the images scan covering so the JOIN can return all needed
	// columns without rowid lookups.
	const t4 = process.hrtime.bigint();
	await db.raw(
		`CREATE INDEX idx_images_covering ON images(pageId, src, alt, width, height, naturalWidth, naturalHeight, isLazy)`,
	);
	console.log(`  built in ${(Number(process.hrtime.bigint() - t4) / 1e6).toFixed(0)}ms`);

	const i1 = await runImages();
	console.log(
		`  listImages: ${i1.toFixed(0)}ms (was ${i0.toFixed(0)}ms, ${(i0 / Math.max(i1, 1)).toFixed(1)}x)`,
	);

	await dumpPlans('AFTER both indexes');
	await regression('AFTER both indexes');

	console.log('\n— Summary —');
	console.log(
		`  listUnusedResources: ${u0.toFixed(0)}ms → ${u1.toFixed(0)}ms (${(u0 / Math.max(u1, 1)).toFixed(1)}x)`,
	);
	console.log(
		`  listImages:          ${i0.toFixed(0)}ms → ${i1.toFixed(0)}ms (${(i0 / Math.max(i1, 1)).toFixed(1)}x)`,
	);
} finally {
	await db.destroy();
	rmSync(workDir, { recursive: true, force: true });
}
console.log('\nDone.');
