#!/usr/bin/env node
/**
 * Adds the `idx_pages_listfilter` composite covering index to an existing
 * `.nitpicker` archive that was created before this index was part of
 * `init-schema.ts`. Cuts the default Pages-view filter from ~15s to ~45ms
 * on a 400k-row archive (368x speedup; see `scripts/bench-partial-listfilter.mjs`).
 *
 * USAGE
 * -----
 *
 *     node scripts/add-pages-listfilter-index.mjs <old.nitpicker> [<new.nitpicker>]
 *
 * If `<new.nitpicker>` is omitted, writes to `<old>.indexed.nitpicker` next
 * to the input. The original file is never modified or deleted.
 *
 * IMPORTANT
 * ---------
 *
 * **This script must NEVER run `ANALYZE`** on the archive. The unanalyzed-
 * table heuristic is what keeps the JOIN paths in `listLinks` / `getLinkGraph`
 * / `listPageLinks` from using this index for source/dest seeks (which would
 * blow them up from ~15s to ~500s, 33x worse). The composite index gives
 * `listPages` its 368x win regardless of stats, but the joins only stay safe
 * while the planner has no per-index statistics. See the JSDoc on the index
 * creation in `init-schema.ts` for the full rationale.
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
		'Usage: node scripts/add-pages-listfilter-index.mjs <old.nitpicker> [<new.nitpicker>]',
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

	console.log(`[2/3] CREATE INDEX idx_pages_listfilter (no ANALYZE)`);
	const db = knex({
		client: LibsqlDialect,
		connection: { filename: dbPath },
		useNullAsDefault: true,
	});
	try {
		// IF NOT EXISTS so the script is idempotent — running it twice is a
		// no-op, matching the migrate-to-0.10 ergonomic.
		await db.raw(
			`CREATE INDEX IF NOT EXISTS idx_pages_listfilter
			 ON pages(scraped, redirectDestId, url, contentType)`,
		);
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
