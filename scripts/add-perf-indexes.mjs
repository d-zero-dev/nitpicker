#!/usr/bin/env node
/**
 * Adds the viewer performance indexes to an existing `.nitpicker` archive
 * that was crawled before any of these indexes were part of
 * `init-schema.ts`. Cuts the worst Viewer queries by 2-9x — confirmed
 * against a 428k-row real customer archive (`scripts/bench-*.mjs`):
 *
 * | Index                       | Query                  | Before | After  | x  |
 * | --------------------------- | ---------------------- | ------ | ------ | -- |
 * | idx_pages_listfilter        | listPages (PR #96)     | 15s    | 45ms   | 368|
 * | idx_resources_internal_url  | listUnusedResources    | 66s    | 7.5s   | 8.8|
 * | idx_images_covering         | listImages             | 32s    | 16s    | 2.0|
 *
 * Renamed from the original `scripts/add-pages-listfilter-index.mjs` (PR
 * #96, listfilter-only) and extended with the two `resources` / `images`
 * indexes shipped by the SQL-first PR. Idempotent — running on an archive
 * that already has any subset of these indexes is a no-op for that subset.
 *
 * USAGE
 * -----
 *
 *     node scripts/add-perf-indexes.mjs <old.nitpicker> [<new.nitpicker>]
 *
 * If `<new.nitpicker>` is omitted, writes to `<old>.indexed.nitpicker` next
 * to the input. The original file is never modified or deleted.
 *
 * IMPORTANT
 * ---------
 *
 * **This script must NEVER run `ANALYZE`** on the archive. The unanalyzed-
 * table heuristic is what keeps the JOIN paths in `listLinks` /
 * `getLinkGraph` / `listPageLinks` from using `idx_pages_listfilter` for
 * source/dest seeks (which would blow them up from ~15s to ~500s,
 * 33x worse). All three indexes are designed so the planner picks them via
 * column-order match without needing statistics. See `init-schema.ts` for
 * the per-index rationale.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import knex from 'knex';
import * as tar from 'tar';

import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';

const inputArg = process.argv[2];
const outputArg = process.argv[3];
if (!inputArg) {
	console.error(
		'Usage: node scripts/add-perf-indexes.mjs <old.nitpicker> [<new.nitpicker>]',
	);
	process.exit(1);
}

const inputPath = path.resolve(inputArg);
if (!existsSync(inputPath)) {
	console.error(`Input archive does not exist: ${inputPath}`);
	process.exit(1);
}

const outputPath = outputArg
	? path.resolve(outputArg)
	: inputPath.replace(/\.nitpicker$/, '.indexed.nitpicker');
if (outputPath === inputPath) {
	console.error('Output path equals input path — refusing to overwrite the original.');
	process.exit(1);
}
if (existsSync(outputPath)) {
	console.error(`Output already exists: ${outputPath}`);
	process.exit(1);
}

const workDir = path.join(path.dirname(outputPath), `._nitpicker-indexer-${process.pid}`);
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

const INDEXES = [
	{
		name: 'idx_pages_listfilter',
		sql: `CREATE INDEX IF NOT EXISTS idx_pages_listfilter
		      ON pages(scraped, redirectDestId, url, contentType)`,
	},
	{
		name: 'idx_resources_internal_url',
		sql: `CREATE INDEX IF NOT EXISTS idx_resources_internal_url
		      ON resources(isExternal, url)`,
	},
	{
		name: 'idx_images_covering',
		sql: `CREATE INDEX IF NOT EXISTS idx_images_covering
		      ON images(pageId, src, alt, width, height, naturalWidth, naturalHeight, isLazy)`,
	},
];

try {
	console.log(`[1/3] untar ${inputPath} -> ${workDir}`);
	await tar.x({ file: inputPath, cwd: workDir });

	const inner = readdirSync(workDir, { withFileTypes: true }).filter(
		(entry) => entry.isDirectory() && !entry.name.startsWith('._'),
	);
	if (inner.length !== 1) {
		throw new Error(
			`Expected exactly one top-level directory inside the archive, got: ${inner.map((entry) => entry.name).join(', ')}`,
		);
	}
	const innerDirName = inner[0].name;
	const dbPath = path.join(workDir, innerDirName, 'db.sqlite');

	console.log(`[2/3] CREATE INDEX × ${INDEXES.length} (no ANALYZE)`);
	const db = knex({
		client: LibsqlDialect,
		connection: { filename: dbPath },
		useNullAsDefault: true,
	});
	try {
		for (const { name, sql } of INDEXES) {
			const start = process.hrtime.bigint();
			await db.raw(sql);
			const ms = Number(process.hrtime.bigint() - start) / 1e6;
			console.log(`      ${ms.toFixed(0).padStart(6)}ms  ${name}`);
		}
		// Deliberately NO `ANALYZE` — see header comment. If `sqlite_stat1`
		// is non-empty for some unrelated reason (a pre-existing manual
		// ANALYZE on this archive), warn the user.
		const stat1Exists = await db.schema.hasTable('sqlite_stat1');
		if (stat1Exists) {
			const rows = await db('sqlite_stat1').count('* as cnt');
			const count = Number(rows[0]?.cnt ?? 0);
			if (count > 0) {
				console.warn(
					`  ⚠ sqlite_stat1 has ${count} rows — the planner may misuse the new index for JOINs.`,
				);
				console.warn(
					`    Consider running \`DELETE FROM sqlite_stat1\` to revert to heuristics.`,
				);
			}
		}
	} finally {
		await db.destroy();
	}

	console.log(`[3/3] tar -> ${outputPath}`);
	await tar.c({ file: outputPath, cwd: workDir, portable: true }, [innerDirName]);
} finally {
	rmSync(workDir, { recursive: true, force: true });
}

console.log(`\nDone. Open with: nitpicker viewer ${outputPath}`);
