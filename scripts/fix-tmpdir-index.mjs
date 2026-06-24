/**
 * In-place fix: drop the old 4-column `idx_pages_listfilter` from the live
 * viewer tmpDir and recreate it with `isExternal` leading so the
 * paginate-query COUNT picks the covering index instead of falling back
 * to `pages_isexternal_index`. Use after restarting the viewer (which
 * re-extracts from the .nitpicker and restores the old shape) until the
 * archive is re-migrated via `scripts/add-perf-indexes.mjs`.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import knex from 'knex';

import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';

const tmpDir = process.argv[2];
if (!tmpDir) {
	console.error('Usage: node scripts/fix-tmpdir-index.mjs <viewer-tmpDir>');
	process.exit(1);
}

const db = knex({
	client: LibsqlDialect,
	connection: { filename: `${tmpDir}/db.sqlite` },
	useNullAsDefault: true,
});

const t = process.hrtime.bigint();
await db.raw('DROP INDEX IF EXISTS idx_pages_listfilter');
await db.raw(
	`CREATE INDEX idx_pages_listfilter
	 ON pages(isExternal, scraped, redirectDestId, url, contentType)`,
);
const ms = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`done in ${ms.toFixed(0)}ms`);

await db.destroy();
