#!/usr/bin/env node
/**
 * Focused bench: does `listPages` at `limit=200` cost more than `limit=100`
 * on the real archive? The user observed it stays slow even after PR #96
 * shipped the 368x speedup at `limit=100`. Decomposes COUNT vs SELECT
 * across multiple offsets and runs the full `listPages` path (including
 * `mapPageRowToListItem`) so we see whether the cost is SQL, JS mapping,
 * or row-size-driven.
 *
 * USAGE
 * -----
 *
 *     node scripts/bench-listpages-sizes.mjs <archive.nitpicker>
 *
 * NEVER runs ANALYZE.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import knex from 'knex';
import * as tar from 'tar';

import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';
import { listPages } from '../packages/@nitpicker/query/lib/list-pages.js';

const archivePath = process.argv[2];
if (!archivePath) {
	console.error('Usage: node scripts/bench-listpages-sizes.mjs <archive.nitpicker>');
	process.exit(1);
}

const workDir = path.join(tmpdir(), `nitpicker-bench-lps-${process.pid}`);
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
console.log(`Untarring to ${workDir} ...`);
await tar.x({ file: path.resolve(archivePath), cwd: workDir });
const inner = readdirSync(workDir, { withFileTypes: true })
	.filter((e) => e.isDirectory() && !e.name.startsWith('._'))
	.map((e) => e.name);
const dbPath = path.join(workDir, inner[0], 'db.sqlite');

const db = knex({
	client: LibsqlDialect,
	connection: { filename: dbPath },
	useNullAsDefault: true,
});

// Ensure PR #96 + this PR's indexes are in place.
await db.raw(
	`CREATE INDEX IF NOT EXISTS idx_pages_listfilter
	 ON pages(isExternal, scraped, redirectDestId, url, contentType)`,
);
await db.raw(
	`CREATE INDEX IF NOT EXISTS idx_resources_internal_url ON resources(isExternal, url)`,
);
await db.raw(
	`CREATE INDEX IF NOT EXISTS idx_images_covering
	 ON images(pageId, src, alt, width, height, naturalWidth, naturalHeight, isLazy)`,
);

const accessor = { getKnex: () => db };

const MATRIX = [
	{ limit: 50, offset: 0 },
	{ limit: 100, offset: 0 },
	{ limit: 200, offset: 0 },
	{ limit: 100, offset: 1000 },
	{ limit: 200, offset: 1000 },
	{ limit: 200, offset: 10_000 },
	{ limit: 200, offset: 50_000 },
];

console.log('\n  limit  offset       COUNT     SELECT-raw  listPages-full  bytes');
for (const { limit, offset } of MATRIX) {
	const t1 = process.hrtime.bigint();
	const c = await db.raw(
		`SELECT count(id) as t FROM pages
		  WHERE scraped=1 AND redirectDestId IS NULL
		    AND (contentType IS NULL OR contentType='text/html')`,
	);
	const countMs = Number(process.hrtime.bigint() - t1) / 1e6;
	void c;

	const t2 = process.hrtime.bigint();
	const rows = await db.raw(
		`SELECT id, url, title, status, contentType, isExternal, description, keywords,
		        lang, charset, themeColor, manifest, robots_raw, robots_noindex,
		        robots_nofollow, robots_noarchive, canonical, og_type, og_title,
		        og_site_name, og_description, og_url, og_image, og_image_alt,
		        og_locale, og_article_published_time, twitter_card, twitter_site,
		        twitter_creator, twitter_image, tag_count, jsonld_count,
		        tags_providers_csv, firstCrawledAt, lastCrawledAt
		   FROM pages
		  WHERE scraped=1 AND redirectDestId IS NULL
		    AND (contentType IS NULL OR contentType='text/html')
		  ORDER BY url ASC LIMIT ${limit} OFFSET ${offset}`,
	);
	const selectMs = Number(process.hrtime.bigint() - t2) / 1e6;
	const bytes = JSON.stringify(rows).length;

	const t3 = process.hrtime.bigint();
	await listPages(accessor, { limit, offset });
	const fullMs = Number(process.hrtime.bigint() - t3) / 1e6;

	console.log(
		`  ${String(limit).padStart(5)}  ${String(offset).padStart(7)}  ${`${countMs.toFixed(0)}ms`.padStart(9)}  ${`${selectMs.toFixed(0)}ms`.padStart(9)}  ${`${fullMs.toFixed(0)}ms`.padStart(13)}  ${`${(bytes / 1024).toFixed(0)}KB`.padStart(7)}`,
	);
}

console.log('\n— EXPLAIN limit=200 offset=10000 —');
const plan = await db.raw(
	`EXPLAIN QUERY PLAN
	 SELECT id, url, title FROM pages
	  WHERE scraped=1 AND redirectDestId IS NULL
	    AND (contentType IS NULL OR contentType='text/html')
	  ORDER BY url ASC LIMIT 200 OFFSET 10000`,
);
for (const r of plan) console.log(`  ${r.detail}`);

await db.destroy();
rmSync(workDir, { recursive: true, force: true });
console.log('\nDone.');
