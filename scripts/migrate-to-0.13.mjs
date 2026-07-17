#!/usr/bin/env node
/**
 * Upgrades a pre-0.13 `.nitpicker` archive (`info.version >= 0.10.0`)
 * to the 0.13 write model. The migration mirrors the shape of
 * `scripts/migrate-to-0.10.mjs`: extract input → mutate `db.sqlite`
 * inside a work dir → re-tar to a new output path. The original input
 * file is never touched. Archives older than 0.10.0 must be run through
 * `migrate-to-0.10.mjs` first — `IncompatibleArchiveError`'s message on
 * archive open names the correct order.
 *
 * USAGE
 * -----
 *
 *     node scripts/migrate-to-0.13.mjs <old.nitpicker> [<new.nitpicker>]
 *
 * If <new.nitpicker> is omitted, writes to `<old>.0.13.nitpicker` next
 * to the input.
 *
 * WHAT IT DOES
 * ------------
 *
 * 1. **Schema catch-up** — creates the ref / header / entity tables
 *    if they are absent (`content_items`, `page_meta`, `resource_items`,
 *    `anchor_edges`, `resource_ref_edges`, `image_items` plus the
 *    ref tables). Idempotent via `CREATE TABLE IF NOT EXISTS`. Also
 *    adds `pages.source` / `resources.source` when the input predates
 *    the `--inventory` feature — the entity populate copies `source`
 *    verbatim, so the columns must exist before it runs.
 * 2. **Ref-table populate** — populates every ref table (`url_refs`,
 *    `text_refs`, `json_refs`, `blob_refs`, `content_type_refs`,
 *    `header_*`) from the still-present pre-0.13 tables.
 * 3. **Entity-table populate** — populates the six entity / edge
 *    tables. All six run inside a single knex transaction so a failure
 *    aborts the whole step; SQLite's WAL rollback returns the DB to
 *    the pre-migration state.
 * 4. **Verification** — runs invariant checks against the populated
 *    archive. The check functions live in
 *    `packages/@nitpicker/crawler/src/archive/verify-migration/` and
 *    the orchestrator `verifyMigration` chains them in the order
 *    documented there. Verification runs **inside** the same
 *    `knex.transaction()` block that ran the entity-populate step so
 *    a `MigrationVerificationError` rolls back every entity INSERT;
 *    ref tables populated earlier stay committed but are additive.
 * 5. **Adjunct FK retarget** — `createAdjunctTables` guarantees the
 *    adjunct set exists (`crawl_errors` / `inventory_runs` and the
 *    `content_items`-referencing five), then `retargetLegacyFkTables`
 *    rebuilds `page_html_ref` / `page_tags` / `page_jsonld` /
 *    `page_errors` / `analysis_violations` so their FK declarations
 *    point at `content_items(id)` instead of the legacy `pages(id)`
 *    (SQLite has no `ALTER TABLE … DROP CONSTRAINT`). Runs with
 *    `PRAGMA foreign_keys = ON` so the data copy validates row-level
 *    integrity as it goes.
 * 6. **Legacy-table drop** — `dropLegacyTables` removes `pages` /
 *    `anchors` / `images` / `resources` / `resources-referrers`.
 *    Enforcement is switched OFF for this step: `pages.redirectDestId`
 *    is a self-FK that can make an enforced `DROP TABLE` fail on
 *    implicit-DELETE row order, and skipping the implicit DELETE lets
 *    SQLite truncate whole b-trees instead of deleting row by row.
 * 7. **FK integrity check** — `checkForeignKeyIntegrity` asserts
 *    `PRAGMA foreign_key_check` reports zero violations against the
 *    final schema.
 * 8. **info.version bump** — writes `info.version = 0.13.0` so a
 *    subsequent CLI open passes `assertCompatibleVersion`. This is
 *    the single mechanism the reader side uses to detect "archive
 *    predates the current format" — no separate per-migration assert.
 * 9. **Re-tar** the work dir to the output path. The input file is
 *    never touched, so it doubles as the rollback artefact — keep it
 *    until the migrated output has been verified in real use
 *    (issue #197 recommends ≥ 30 days).
 *
 * DOM-PATH DERIVATION
 * -------------------
 *
 * `image_items.dom_path_text_id` is derived from `images.sourceCode`
 * against the archived HTML snapshot by parsing each page's HTML with
 * jsdom and applying a 3-case match algorithm:
 *
 * - single match — exact `outerHTML` match in the DOM.
 * - ordinal match — multiple identical `<img>` outerHTML on one page,
 *   assigned in `images.id` order.
 * - unknown — no `sourceCode` or no DOM match; falls back to the
 *   synthetic `unknown/<images.id>` marker. A warning is logged for
 *   every unknown fallback so operators can audit fidelity.
 *
 * The HTML parser dependency lives only in this script (not in the
 * crawler runtime); `populate-image-items.ts` accepts an injected
 * resolver so the crawler package stays parser-agnostic at runtime.
 *
 * Parsing uses parse5 (`create-dom-path-resolver.mjs`), not jsdom. An
 * earlier version of this script used jsdom, which runs every parsed
 * document inside its own `Window`'s V8 `vm` context — a context V8
 * does not reliably reclaim even with a forced `globalThis.gc()` call
 * between pages (measured against a real 380 K-image archive: a
 * Mark-Compact pass reclaimed under 2 MB out of a 12 GB heap). parse5
 * produces a plain-object AST with no backing `vm` context, so the
 * per-page retention does not exist in the first place — no worker
 * pool or recycling is needed.
 *
 * NOT SHIPPED IN NPM
 * ------------------
 *
 * This script is not part of the `@nitpicker/*` npm bundles; use it via
 * `git clone` + `yarn build`.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import knex from 'knex';
import * as tar from 'tar';

import { createAdjunctTables } from '../packages/@nitpicker/crawler/lib/archive/create-adjunct-tables.js';
import { dropLegacyTables } from '../packages/@nitpicker/crawler/lib/archive/drop-legacy-tables.js';
import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';
import { migrateEntityTables } from '../packages/@nitpicker/crawler/lib/archive/migrate-entity-tables.js';
import { migrateRefTables } from '../packages/@nitpicker/crawler/lib/archive/migrate-ref-tables.js';
import { populateEntityTables } from '../packages/@nitpicker/crawler/lib/archive/populate-entity-tables/populate-entities.js';
import { populateRefTables } from '../packages/@nitpicker/crawler/lib/archive/populate-ref-tables/populate-refs.js';
import { retargetLegacyFkTables } from '../packages/@nitpicker/crawler/lib/archive/retarget-legacy-fk-tables.js';
import { checkForeignKeyIntegrity } from '../packages/@nitpicker/crawler/lib/archive/verify-migration/check-foreign-key-integrity.js';
import { verifyMigration } from '../packages/@nitpicker/crawler/lib/archive/verify-migration/verify-migration.js';

import { createDomPathResolver } from './create-dom-path-resolver.mjs';

const SQLITE_DB_FILE_NAME = 'db.sqlite';

/**
 * Entry point.
 */
async function main() {
	const [inputArg, outputArg] = process.argv.slice(2);
	if (!inputArg) {
		console.error(
			'Usage: node scripts/migrate-to-0.13.mjs <old.nitpicker> [<new.nitpicker>]',
		);
		process.exit(1);
	}
	const inputPath = path.resolve(inputArg);
	const outputPath = path.resolve(
		outputArg ??
			path.join(
				path.dirname(inputPath),
				`${path.basename(inputPath, path.extname(inputPath))}.0.13.nitpicker`,
			),
	);
	if (!existsSync(inputPath)) {
		console.error(`Input not found: ${inputPath}`);
		process.exit(1);
	}
	if (existsSync(outputPath)) {
		console.error(`Output already exists: ${outputPath} — remove it first`);
		process.exit(1);
	}

	const workDir = path.resolve(
		path.dirname(outputPath),
		`._migrate-to-0.13-${process.pid}-${path.basename(inputPath, path.extname(inputPath))}`,
	);
	if (existsSync(workDir)) {
		console.error(`Stale work dir present: ${workDir} — remove it first`);
		process.exit(1);
	}
	mkdirSync(workDir, { recursive: true });

	try {
		console.log(`[1/3] untar ${inputPath} -> ${workDir}`);
		await tar.x({ file: inputPath, cwd: workDir });

		const innerDirName = findInnerDir(workDir);
		const extractedDir = path.join(workDir, innerDirName);
		const dbPath = path.join(extractedDir, SQLITE_DB_FILE_NAME);
		if (!existsSync(dbPath)) {
			throw new Error(`Missing ${SQLITE_DB_FILE_NAME} in input archive`);
		}

		console.log('[2/3] apply 0.13 migration migrations');
		await applyMigrations(dbPath);

		// libsql leaves -wal / -shm sidecars after close — remove them so
		// the re-tar contains a clean single-file db.sqlite.
		for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
			if (existsSync(sidecar)) rmSync(sidecar, { force: true });
		}

		console.log(`[3/3] tar -> ${outputPath}`);
		await tar.c({ file: outputPath, cwd: workDir, portable: true }, [innerDirName]);

		console.log('Done.');
	} catch (error) {
		if (existsSync(outputPath)) {
			rmSync(outputPath, { force: true });
		}
		throw error;
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}

/**
 * Finds the single top-level directory created by untar inside `workDir`.
 * Copied from `migrate-to-0.10.mjs` because that script is a stand-alone
 * .mjs and does not export helpers; keeping the helper local avoids a
 * cross-script coupling for a 20-line predicate.
 *
 * Skips macOS AppleDouble (`._*`) sidecar files that BSD tar embeds and
 * Node's `tar` library surfaces verbatim.
 * @param {string} workDir
 * @returns {string} Inner directory basename.
 */
function findInnerDir(workDir) {
	const candidates = readdirSync(workDir).filter((name) => {
		if (name.startsWith('._')) return false;
		const stat = statSync(path.join(workDir, name));
		return stat.isDirectory();
	});
	if (candidates.length === 0) {
		throw new Error(
			`Untar did not produce a top-level directory inside ${workDir}. ` +
				`Input may be a non-Nitpicker tar or corrupted.`,
		);
	}
	if (candidates.length > 1) {
		throw new Error(
			`Untar produced multiple top-level directories inside ${workDir}: ${candidates.join(', ')}.`,
		);
	}
	return candidates[0];
}

/**
 * Opens the extracted `db.sqlite` and applies every 0.13 migration step:
 * schema catch-up, populate refs, populate entities, verify invariants,
 * and finally bump `info.version` to `0.13.0`. Populate + verify run
 * inside a single knex transaction so the whole batch either commits or
 * rolls back on failure.
 * @param {string} dbPath - Path to the extracted `db.sqlite`.
 */
async function applyMigrations(dbPath) {
	const db = knex({
		client: LibsqlDialect,
		connection: { filename: dbPath },
		useNullAsDefault: true,
	});
	try {
		await db.raw('PRAGMA journal_mode = WAL');
		await db.raw('PRAGMA foreign_keys = ON');

		console.log('  ensure ref tables');
		await migrateRefTables(db);
		console.log('  ensure entity tables');
		await migrateEntityTables(db);
		await ensureLegacySourceColumns(db);

		console.log('  populate ref tables');
		await db.transaction(async (trx) => {
			await populateRefTables(trx);
		});

		console.log('  populate entity tables');
		const domPathResolver = createDomPathResolver();
		/** @type {import('../packages/@nitpicker/crawler/lib/archive/verify-migration/types.js').MigrationVerificationSummary} */
		let summary;
		await db.transaction(async (trx) => {
			await populateEntityTables(trx, domPathResolver);
			console.log('  verify migration invariants');
			summary = await verifyMigration(trx);
		});
		console.log(
			`  verification passed — content_items=${summary.contentItems}, ` +
				`page_meta=${summary.pageMeta}, anchor_edges=${summary.anchorEdges} ` +
				`(sum count=${summary.anchorEdgesSum}), image_items=${summary.imageItems}, ` +
				`resource_items=${summary.resourceItems}`,
		);

		console.log('  ensure adjunct tables');
		await createAdjunctTables(db);

		// Retarget under enforcement so the data copy validates every
		// pageId / page_id against content_items row by row.
		console.log('  retarget adjunct FKs → content_items(id)');
		await db.transaction(async (trx) => {
			await retargetLegacyFkTables(trx);
		});

		// The drop runs with enforcement OFF: `pages.redirectDestId` is a
		// self-FK that can fail an enforced DROP TABLE's implicit DELETE on
		// row order, and skipping the implicit DELETE truncates whole
		// b-trees instead of deleting hundreds of thousands of rows one by
		// one. `PRAGMA foreign_keys` cannot change inside a transaction, so
		// this is a separate transaction from the retarget above — safe
		// because the whole mutation happens in the extracted work dir and
		// the output tar is only produced when every step has succeeded.
		console.log(
			'  drop legacy tables (pages/anchors/images/resources/resources-referrers)',
		);
		await db.raw('PRAGMA foreign_keys = OFF');
		await db.transaction(async (trx) => {
			await dropLegacyTables(trx);
		});
		await db.raw('PRAGMA foreign_keys = ON');

		console.log('  verify foreign_key_check reports zero violations');
		try {
			await checkForeignKeyIntegrity(db);
		} catch (error) {
			console.error(
				'FK integrity check failed after retarget + drop. This indicates ' +
					'either corruption in the input archive or a bug in the FK rebuild. ' +
					'No output was produced; the input archive is untouched — inspect it ' +
					'before re-running.',
			);
			throw error;
		}

		// Bump info.version so `assertCompatibleVersion` accepts the archive
		// on next open. This is the single mechanism the reader-side uses to
		// detect "archive predates the current format" — no separate assert
		// per migration.
		//
		// An archive whose `info` table is empty (interrupted crawl that
		// never reached `setConfig`, or a hand-crafted db) would silently
		// pass a bare `UPDATE ... SET version = ...` — the UPDATE
		// affects zero rows and reports success, and the reader path then
		// blows up with `IncompatibleArchiveError` because `info.version`
		// is missing. Read back the row count and abort with a clear
		// error before the archive is repacked (mutation happens only in
		// the extracted work dir, so the input archive stays intact).
		console.log('  bump info.version → 0.13.0');
		const infoRowsBefore = await db('info').count({ n: '*' });
		const infoRowCount = Number(infoRowsBefore[0]?.n ?? 0);
		if (infoRowCount === 0) {
			throw new Error(
				`migrate-to-0.13: refusing to migrate an archive whose \`info\` table is empty — no \`info.version\` row exists to bump. This typically happens when a crawl was interrupted before \`setConfig\` ran and the archive is not consumable in the first place. Re-crawl the target instead of migrating the empty stub.`,
			);
		}
		await db('info').update({ version: '0.13.0' });

		await db.raw('PRAGMA wal_checkpoint(TRUNCATE)');
	} finally {
		await db.destroy();
	}
}

/**
 * Adds the `source` provenance column to `pages` / `resources` when the
 * input archive predates the `crawl --inventory` feature. The entity
 * populate (`populate-content-items.ts` / `populate-resource-items.ts`)
 * SELECTs the column and copies it verbatim into
 * `content_items.source` / `resource_items.source`, so it must exist
 * before the populate runs. SQLite applies the NOT NULL DEFAULT at
 * column-add time, so pre-existing rows become `'crawled'` without an
 * explicit backfill UPDATE.
 * @param {import('knex').Knex} db - Knex handle on the extracted `db.sqlite`.
 */
async function ensureLegacySourceColumns(db) {
	for (const table of ['pages', 'resources']) {
		if (await db.schema.hasColumn(table, 'source')) {
			continue;
		}
		await db.schema.table(table, (t) => {
			t.string('source').notNullable().defaultTo('crawled');
			t.index('source');
		});
		console.log(`  added ${table}.source (input predates crawl --inventory)`);
	}
}

try {
	await main();
} catch (error) {
	console.error(error);
	process.exit(1);
}
