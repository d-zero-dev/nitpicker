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
 *    ref tables). Idempotent via `CREATE TABLE IF NOT EXISTS`.
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
 * 5. **info.version bump** — writes `info.version = 0.13.0` so a
 *    subsequent CLI open passes `assertCompatibleVersion`. This is
 *    the single mechanism the reader side uses to detect "archive
 *    predates the current format" — no separate per-migration assert.
 * 6. **Re-tar** the work dir to the output path.
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
 * The jsdom dependency lives only in this script (not in the crawler
 * runtime); `populate-image-items.ts` accepts an injected resolver so
 * the crawler package stays jsdom-free at runtime.
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

import { JSDOM, VirtualConsole } from 'jsdom';
import knex from 'knex';
import * as tar from 'tar';

import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';
import { migrateEntityTables } from '../packages/@nitpicker/crawler/lib/archive/migrate-entity-tables.js';
import { migrateRefTables } from '../packages/@nitpicker/crawler/lib/archive/migrate-ref-tables.js';
import { matchImagesToDomPaths } from '../packages/@nitpicker/crawler/lib/archive/populate-entity-tables/match-images-to-dom-paths.js';
import { populateEntityTables } from '../packages/@nitpicker/crawler/lib/archive/populate-entity-tables/populate-entities.js';
import { populateRefTables } from '../packages/@nitpicker/crawler/lib/archive/populate-ref-tables/populate-refs.js';
import { verifyMigration } from '../packages/@nitpicker/crawler/lib/archive/verify-migration/verify-migration.js';

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

		console.log('  populate ref tables');
		await db.transaction(async (trx) => {
			await populateRefTables(trx);
		});

		console.log('  populate entity tables');
		const domPathResolver = createJsdomDomPathResolver();
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
 * Returns a `PageDomPathResolver` (see
 * `packages/@nitpicker/crawler/src/archive/populate-entity-tables/populate-image-items.ts`)
 * that parses HTML with jsdom and applies the 3-case match algorithm from
 * `packages/@nitpicker/crawler/src/archive/populate-entity-tables/match-images-to-dom-paths.ts`.
 *
 * jsdom's `VirtualConsole` is silenced because production HTML crashes
 * emit a torrent of `unhandled` warnings (unrecognised CSS at-rules,
 * scripts that reference `window`) that are irrelevant to `<img>` DOM
 * position derivation.
 */
function createJsdomDomPathResolver() {
	const virtualConsole = new VirtualConsole();
	virtualConsole.on('jsdomError', () => {});
	return async (pageId, htmlString, images) => {
		if (htmlString === null) {
			// Every image on this page falls back — emit a per-image
			// warning so operators can audit reconstruction fidelity,
			// not just a single "no HTML for page X" line.
			return fallbackAllUnknown(images, pageId, 'no HTML snapshot stored');
		}
		let dom;
		try {
			dom = new JSDOM(htmlString, { virtualConsole });
		} catch (error) {
			return fallbackAllUnknown(
				images,
				pageId,
				`jsdom parse failed: ${error?.message ?? error}`,
			);
		}
		try {
			const imgElements = [...dom.window.document.querySelectorAll('img')];
			const result = matchImagesToDomPaths(images, imgElements);
			for (const [imageId, entry] of result) {
				if (entry.case === 'unknown') {
					console.warn(
						`[dom-path] unknown fallback for image id=${imageId} (page ${pageId})`,
					);
				}
			}
			return result;
		} finally {
			dom.window.close();
		}
	};
}

/**
 * Returns a `Map<imageId, DomPathResult>` where every image resolves to
 * the `unknown/<id>` fallback and emits one warning line per image so
 * the audit log records a warning for every `unknown/*` fallback —
 * the contract operators rely on to audit reconstruction fidelity.
 * Used when jsdom cannot parse the page
 * OR when the page has no stored HTML snapshot at all.
 * @param {readonly { id: number }[]} images
 * @param {number} pageId
 * @param {string} reason - Human-readable reason for the whole-page fallback.
 */
function fallbackAllUnknown(images, pageId, reason) {
	const map = new Map();
	for (const image of images) {
		map.set(image.id, { path: `unknown/${image.id}`, case: 'unknown' });
		console.warn(
			`[dom-path] unknown fallback for image id=${image.id} (page ${pageId}): ${reason}`,
		);
	}
	return map;
}

try {
	await main();
} catch (error) {
	console.error(error);
	process.exit(1);
}
