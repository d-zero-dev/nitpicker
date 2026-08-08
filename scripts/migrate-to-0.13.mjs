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
 *     node scripts/migrate-to-0.13.mjs <old.nitpicker> [<new.nitpicker>] [--skip-disk-check]
 *
 * If <new.nitpicker> is omitted, writes to `<old>.0.13.nitpicker` next
 * to the input. `--skip-disk-check` bypasses the startup disk-space
 * estimate (see RESUMING AFTER A KILL below) for operators who have
 * already confirmed enough free space by other means.
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
 *    verbatim, so the columns must exist before it runs. Skipped
 *    entirely once the legacy tables are gone (see step 6).
 * 2. **Ref-table populate** — populates every ref table (`url_refs`,
 *    `text_refs`, `json_refs`, `blob_refs`, `content_type_refs`,
 *    `header_*`) from the still-present pre-0.13 tables. Each of the
 *    six sub-populates commits in its own transaction and records a
 *    `_migrate_progress` row, so a kill partway through this step only
 *    costs the one table in flight on the next run, not the whole step.
 * 3. **Entity-table populate** — populates the six entity / edge
 *    tables. All six run inside a single knex transaction so a failure
 *    aborts the whole step; SQLite's WAL rollback returns the DB to
 *    the pre-migration state. A `_migrate_progress` row recorded in
 *    the same transaction lets a resumed run skip this (potentially
 *    multi-hour) step entirely once it has committed once.
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
 *    integrity as it goes. Recorded in `_migrate_progress` so a
 *    resumed run skips it once done.
 * 6. **Legacy-table drop** — `dropLegacyTables` removes `pages` /
 *    `anchors` / `images` / `resources` / `resources-referrers`.
 *    Enforcement is switched OFF for this step: `pages.redirectDestId`
 *    is a self-FK that can make an enforced `DROP TABLE` fail on
 *    implicit-DELETE row order, and skipping the implicit DELETE lets
 *    SQLite truncate whole b-trees instead of deleting row by row.
 *    `dropLegacyTables` is itself `DROP TABLE IF EXISTS`-based and
 *    safe to call unconditionally on every run. Once the legacy tables
 *    are gone, steps 1–4 are skipped on any subsequent run (see
 *    RESUMING AFTER A KILL) — running them against a dropped `pages`
 *    would fail outright, not silently no-op.
 * 7. **FK integrity check** — `checkForeignKeyIntegrity` asserts
 *    `PRAGMA foreign_key_check` reports zero violations against the
 *    final schema.
 * 8. **info.version bump** — writes `info.version = 0.13.0` so a
 *    subsequent CLI open passes `assertCompatibleVersion`. This is
 *    the single mechanism the reader side uses to detect "archive
 *    predates the current format" — no separate per-migration assert.
 *    `_migrate_progress` is dropped immediately after so it never
 *    ships in the output archive.
 * 9. **Viewer read model build** — `buildViewerReadModel` runs against
 *    the migrated archive so it opens in the viewer's fast path
 *    immediately, matching what a live crawl gets for free at crawl
 *    completion, instead of requiring a separate `viewer-build` run
 *    an operator has to remember. A `.viewer-build-complete` sentinel
 *    file next to the extracted archive (not a DB row — the DB's
 *    `_migrate_progress` is already gone by this point) lets a
 *    resumed run skip a repeat build.
 * 10. **Re-tar** the work dir to `<output>.tmp`, then rename it to the
 *    final output path. The rename is the commit point: a kill during
 *    the tar write leaves only a `.tmp` file behind, never a
 *    half-written file at the real output path. The input file is
 *    never touched, so it doubles as the rollback artefact — keep it
 *    until the migrated output has been verified in real use
 *    (issue #197 recommends ≥ 30 days).
 *
 * RESUMING AFTER A KILL
 * ---------------------
 *
 * A large archive's migration can run for hours; this script is built
 * to survive a `SIGKILL` (OOM, operator `kill -9`, terminal closed)
 * partway through and pick back up close to where it left off on the
 * next invocation with the same arguments:
 *
 * - The work dir is named after the *output* path only (no PID), so a
 *   re-invocation resolves to the same directory a killed run used.
 * - The work dir is only removed on a fully successful run. A kill —
 *   or any thrown error — leaves it in place for the next attempt.
 * - Untar only runs once: completion is marked by a
 *   `.untar-complete` sentinel file in the work dir (not the presence
 *   of `db.sqlite`, which can exist in a truncated, unusable state if
 *   the kill landed mid-extraction). Without the sentinel the work dir
 *   is wiped and re-extracted from scratch.
 * - An advisory lock (`acquireArchiveLock`, the same mechanism
 *   `Archive.resume` uses) on the work dir stops two invocations
 *   against the same output from clobbering each other; a lock left
 *   by a killed process is reclaimed automatically once its PID is
 *   confirmed dead.
 * - Every phase from step 2 onward is checkpointed (`_migrate_progress`
 *   table rows, committed in the same transaction as the phase itself,
 *   or the `.viewer-build-complete` file for the one step that runs
 *   after `_migrate_progress` is dropped) so a resumed run skips
 *   whatever already committed instead of redoing it.
 * - If the legacy tables (`pages` etc.) are already gone — the kill
 *   landed after step 6 — steps 1–4 are skipped outright rather than
 *   attempted against tables that no longer exist.
 * - A startup disk-space check estimates the peak usage (roughly
 *   input-size × 2 for a fresh run, × 1.2 for a resume where the work
 *   dir already exists) against the output volume's free space and
 *   refuses to start if it looks insufficient, rather than running for
 *   hours and failing on `ENOSPC`. Pass `--skip-disk-check` to bypass.
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

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	statfsSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import knex from 'knex';
import * as tar from 'tar';

import { acquireArchiveLock } from '../packages/@nitpicker/crawler/lib/archive/archive-lock.js';
import Archive from '../packages/@nitpicker/crawler/lib/archive/archive.js';
import { createAdjunctTables } from '../packages/@nitpicker/crawler/lib/archive/create-adjunct-tables.js';
import { dropLegacyTables } from '../packages/@nitpicker/crawler/lib/archive/drop-legacy-tables.js';
import { rename } from '../packages/@nitpicker/crawler/lib/archive/filesystem/rename.js';
import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';
import { migrateEntityTables } from '../packages/@nitpicker/crawler/lib/archive/migrate-entity-tables.js';
import { migrateRefTables } from '../packages/@nitpicker/crawler/lib/archive/migrate-ref-tables.js';
import { populateEntityTables } from '../packages/@nitpicker/crawler/lib/archive/populate-entity-tables/populate-entities.js';
import { populateBlobRefs } from '../packages/@nitpicker/crawler/lib/archive/populate-ref-tables/populate-blob-refs.js';
import { populateContentTypeRefs } from '../packages/@nitpicker/crawler/lib/archive/populate-ref-tables/populate-content-type-refs.js';
import { populateHeaderTables } from '../packages/@nitpicker/crawler/lib/archive/populate-ref-tables/populate-header-tables.js';
import { populateJsonRefs } from '../packages/@nitpicker/crawler/lib/archive/populate-ref-tables/populate-json-refs.js';
import { populateTextRefs } from '../packages/@nitpicker/crawler/lib/archive/populate-ref-tables/populate-text-refs.js';
import { populateUrlRefs } from '../packages/@nitpicker/crawler/lib/archive/populate-ref-tables/populate-url-refs.js';
import { retargetLegacyFkTables } from '../packages/@nitpicker/crawler/lib/archive/retarget-legacy-fk-tables.js';
import { checkForeignKeyIntegrity } from '../packages/@nitpicker/crawler/lib/archive/verify-migration/check-foreign-key-integrity.js';
import { verifyMigration } from '../packages/@nitpicker/crawler/lib/archive/verify-migration/verify-migration.js';
import { buildViewerReadModel } from '../packages/@nitpicker/query/lib/viewer-read-model/build-viewer-read-model.js';

import { createDomPathResolver } from './create-dom-path-resolver.mjs';

const SQLITE_DB_FILE_NAME = 'db.sqlite';
const UNTAR_COMPLETE_MARKER = '.untar-complete';
const VIEWER_BUILD_COMPLETE_MARKER = '.viewer-build-complete';
const SOURCE_FINGERPRINT_FILE = '.source-fingerprint.json';

/** `_migrate_progress` step names, shared between the writer (`markStepComplete`) and the reader (`hasCompletedStep`) call sites so a typo in one can't silently drift out of sync with the other and leave a step re-running forever without ever surfacing as an error. */
const STEP_ENTITY_AND_VERIFY = 'entity_and_verify';
const STEP_RETARGET = 'retarget';

/** The five legacy write-model tables `dropLegacyTables` removes together in one transaction — checking all five (not just `pages`) keeps the "are the legacy tables gone" guard correct even if a future change makes the drop itself resumable in separate steps. */
const LEGACY_TABLE_NAMES = [
	'pages',
	'anchors',
	'images',
	'resources',
	'resources-referrers',
];

/**
 * `onProgress` sink threaded into the ref-table sub-populates / `populateEntityTables`
 * (see `packages/@nitpicker/crawler/src/archive/create-progress-reporter.ts`).
 * Each sub-populate reports at most once per ~5% of its source table
 * scanned, so a multi-million-row table produces ~20 lines total instead
 * of one per chunk.
 * @param {string} message
 */
function logProgress(message) {
	console.log(`    ${message}`);
}

/**
 * Entry point.
 */
async function main() {
	const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
	const skipDiskCheck = process.argv.includes('--skip-disk-check');
	const [inputArg, outputArg] = positional;
	if (!inputArg) {
		console.error(
			'Usage: node scripts/migrate-to-0.13.mjs <old.nitpicker> [<new.nitpicker>] [--skip-disk-check]',
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

	const workDir = path.resolve(
		path.dirname(outputPath),
		`._migrate-to-0.13-${path.basename(outputPath, path.extname(outputPath))}`,
	);
	const tmpOutputPath = `${outputPath}.tmp`;

	if (existsSync(outputPath) && !existsSync(workDir)) {
		console.error(`Output already exists: ${outputPath} — remove it first`);
		process.exit(1);
	}

	// Acquire the lock before inspecting workDir's contents (or deciding
	// the run below is already complete) so two concurrent invocations
	// against the same output can't both decide "not yet extracted" and
	// race to untar into it, and so a still-running process's work dir
	// can never be mistaken for leftover-after-success debris. A lock
	// held by a killed process (stale PID) is reclaimed automatically;
	// one held by a live process surfaces as an `ArchiveLockError` here.
	const releaseLock = await acquireArchiveLock(workDir);

	const startedAt = Date.now();
	try {
		if (existsSync(outputPath)) {
			// Now that the lock is ours, no other process is actively
			// working on this pair. Confirm the work dir actually belongs to
			// THIS input before trusting that — a prior run against a
			// different input file at the same output path would otherwise
			// look identical from here (see `sourceFingerprintMatches`).
			if (!sourceFingerprintMatches(workDir, inputPath)) {
				console.error(
					`Output already exists: ${outputPath} — remove it first. ` +
						`(A work dir also exists at ${workDir}, but it does not match ${inputPath} — ` +
						`inspect both manually before proceeding.)`,
				);
				process.exit(1);
			}
			// A prior run must have finished the rename but been killed
			// before its own cleanup. The migration itself already
			// succeeded; clean up and exit successfully instead of erroring
			// "remove it first" on a file that is, in fact, the correct
			// finished output.
			console.log(`Output already exists: ${outputPath}`);
			console.log(
				'A previous run already completed successfully — cleaning up and exiting.',
			);
			rmSync(workDir, { recursive: true, force: true });
			return;
		}
		if (existsSync(tmpOutputPath)) {
			// Leftover from a re-tar killed mid-write; never a valid output.
			rmSync(tmpOutputPath, { force: true });
		}

		let isResuming = existsSync(path.join(workDir, UNTAR_COMPLETE_MARKER));
		if (isResuming && !sourceFingerprintMatches(workDir, inputPath)) {
			console.log(
				`  work dir exists but does not match ${inputPath} (different file, or the ` +
					`original was renamed/replaced) — starting fresh instead of resuming`,
			);
			isResuming = false;
		}
		checkDiskSpace(path.dirname(outputPath), inputPath, isResuming, skipDiskCheck);

		if (isResuming) {
			console.log(`[1/3] resuming existing work dir (skip untar): ${workDir}`);
		} else {
			rmSync(workDir, { recursive: true, force: true });
			mkdirSync(workDir, { recursive: true });
			console.log(`[1/3] untar ${inputPath} -> ${workDir}`);
			await tar.x({ file: inputPath, cwd: workDir });
			writeSourceFingerprint(workDir, inputPath);
			writeFileSync(path.join(workDir, UNTAR_COMPLETE_MARKER), '');
		}
		const extractedDir = path.join(workDir, findInnerDir(workDir));

		const dbPath = path.join(extractedDir, SQLITE_DB_FILE_NAME);
		if (!existsSync(dbPath)) {
			throw new Error(`Missing ${SQLITE_DB_FILE_NAME} in input archive`);
		}

		console.log('[2/3] apply 0.13 migration migrations');
		await applyMigrations(dbPath);

		const viewerBuildMarker = path.join(workDir, VIEWER_BUILD_COMPLETE_MARKER);
		if (existsSync(viewerBuildMarker)) {
			console.log('  build viewer read model: already done, skipping');
		} else {
			console.log('  build viewer read model');
			await buildArchiveViewerReadModel(extractedDir);
			writeFileSync(viewerBuildMarker, '');
		}

		// libsql leaves -wal / -shm sidecars after close — remove them so
		// the re-tar contains a clean single-file db.sqlite.
		for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
			if (existsSync(sidecar)) rmSync(sidecar, { force: true });
		}

		console.log(`[3/3] tar -> ${outputPath}`);
		await tar.c({ file: tmpOutputPath, cwd: workDir, portable: true }, [
			path.basename(extractedDir),
		]);
		await rename(tmpOutputPath, outputPath, false);

		console.log(`Done. (${formatElapsed(Date.now() - startedAt)})`);
		rmSync(workDir, { recursive: true, force: true });
	} catch (error) {
		console.error(
			`Migration failed. The work dir was preserved for a resumed attempt: ${workDir}\n` +
				`  - Re-run the exact same command to resume.\n` +
				`  - To discard the partial progress instead, run: rm -rf ${workDir}`,
		);
		throw error;
	} finally {
		await releaseLock();
	}
}

/**
 * Estimates the peak disk usage this script needs on the output volume
 * and aborts before any work starts if the volume looks too full. The
 * estimate is deliberately generous rather than exact: a fresh run
 * needs room for both the extracted work dir (roughly input-sized, plus
 * growth from the new entity/ref tables and WAL churn during the
 * entity-populate transaction) and the final output tar alongside it,
 * so `input size × 2` approximates the worst case. A resumed run
 * (`isResuming`) already has the work dir on disk — it only needs room
 * for the output tar plus headroom for continued DB growth, hence the
 * smaller `× 1.2` multiplier.
 *
 * This is a coarse guard, not a guarantee (actual growth depends on the
 * archive's data shape) — `--skip-disk-check` lets an operator who has
 * independently confirmed enough free space bypass it.
 * @param {string} outputDir - Directory the output (and work dir) live in.
 * @param {string} inputPath - Path to the input `.nitpicker` archive.
 * @param {boolean} isResuming - Whether an already-extracted work dir is being reused.
 * @param {boolean} skip - Whether to bypass the check entirely.
 */
function checkDiskSpace(outputDir, inputPath, isResuming, skip) {
	if (skip) {
		return;
	}
	const inputSize = statSync(inputPath).size;
	const requiredBytes = Math.ceil(inputSize * (isResuming ? 1.2 : 2));
	const stats = statfsSync(outputDir);
	const availableBytes = stats.bavail * stats.bsize;
	if (availableBytes < requiredBytes) {
		// Thrown rather than `process.exit()`ed so the caller's `finally`
		// still releases the work dir lock — nothing has been written yet
		// at this point, so there is no partial state to preserve either.
		throw new Error(
			`Insufficient disk space in ${outputDir}: need ~${formatBytes(requiredBytes)}, ` +
				`have ${formatBytes(availableBytes)} available. Free up space, or pass ` +
				`--skip-disk-check if you have independently confirmed there is enough room.`,
		);
	}
}

/**
 * Formats a byte count as a rough `<N> GB`/`MB` string for the disk-space
 * error message — not meant for precision, just enough for an operator
 * to judge the shortfall at a glance.
 * @param {number} bytes
 */
function formatBytes(bytes) {
	const gb = bytes / 1024 ** 3;
	if (gb >= 1) {
		return `${gb.toFixed(1)} GB`;
	}
	return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

/**
 * Formats a millisecond duration as a rough `<hours>h <minutes>m
 * <seconds>s` string (dropping leading zero units) for the
 * operator-facing `Done.` line — not meant for precise timing, just
 * "was this quick or did it take a while". Archives large enough to
 * run for multiple hours are realistic, so hours are included;
 * multi-day runs are not expected for a single archive and are not
 * specially formatted.
 * @param {number} ms
 */
function formatElapsed(ms) {
	const totalSeconds = Math.round(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return `${hours}h ${minutes}m ${seconds}s`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}

/**
 * Finds the single top-level directory created by untar inside `workDir`.
 * Copied from `migrate-to-0.10.mjs` because that script is a stand-alone
 * .mjs and does not export helpers; keeping the helper local avoids a
 * cross-script coupling for a 20-line predicate.
 *
 * Skips macOS AppleDouble (`._*`) sidecar files that BSD tar embeds and
 * Node's `tar` library surfaces verbatim, and the sentinel files this
 * script itself writes at the work dir root (`.untar-complete`,
 * `.viewer-build-complete`).
 * @param {string} workDir
 * @returns {string} Inner directory basename.
 */
function findInnerDir(workDir) {
	const candidates = readdirSync(workDir).filter((name) => {
		if (name.startsWith('.')) return false;
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
 * Records `inputPath`'s size and mtime in `workDir` right after a fresh
 * untar. `workDir` is named only from the *output* path (see `main()`), so
 * a resumed run's `.untar-complete` sentinel alone cannot tell "this work
 * dir was extracted from the exact input given this time" from "this work
 * dir happens to sit at the path this output would use, but was extracted
 * from a different input archive entirely" — e.g. the same output path
 * re-run against a different source file after a kill. Content hashing
 * would be unambiguous but prohibitively slow to redo on every resumed
 * invocation of a multi-gigabyte archive; size + mtime is cheap (a single
 * `stat` call) and enough to catch "wrong file", while still matching
 * across a plain rename (which preserves both) — renaming a `.nitpicker`
 * after the fact is a normal, expected operation (see `peekTarTopDir`'s
 * own doc comment).
 * @param {string} workDir
 * @param {string} inputPath
 */
function writeSourceFingerprint(workDir, inputPath) {
	const stat = statSync(inputPath);
	writeFileSync(
		path.join(workDir, SOURCE_FINGERPRINT_FILE),
		JSON.stringify({ size: stat.size, mtimeMs: stat.mtimeMs }),
	);
}

/**
 * Whether `workDir`'s recorded source fingerprint (see
 * {@link writeSourceFingerprint}) matches `inputPath` as it stands now.
 * Returns `false` — never throws — when the fingerprint file is missing
 * (e.g. a work dir left by a version of this script that predates the
 * fingerprint) so callers can treat a missing/mismatched fingerprint
 * uniformly as "cannot trust this work dir belongs to this input".
 * @param {string} workDir
 * @param {string} inputPath
 * @returns {boolean}
 */
function sourceFingerprintMatches(workDir, inputPath) {
	const fingerprintPath = path.join(workDir, SOURCE_FINGERPRINT_FILE);
	if (!existsSync(fingerprintPath)) {
		return false;
	}
	/** @type {{ size: number, mtimeMs: number }} */
	let recorded;
	try {
		recorded = JSON.parse(readFileSync(fingerprintPath, 'utf8'));
	} catch {
		return false;
	}
	const stat = statSync(inputPath);
	return recorded.size === stat.size && recorded.mtimeMs === stat.mtimeMs;
}

/**
 * Records that `step` has completed by inserting a row into
 * `_migrate_progress`. Called from inside the same transaction as the
 * step's own writes so the marker and the data it describes commit
 * atomically — there is no window where one is visible without the
 * other.
 * @param {import('knex').Knex} trx
 * @param {string} step
 */
async function markStepComplete(trx, step) {
	await trx('_migrate_progress')
		.insert({ step, completed_at: new Date().toISOString() })
		.onConflict('step')
		.ignore();
}

/**
 * Whether `step` was already recorded as complete by {@link markStepComplete}
 * in a prior (possibly killed) run. Every call site treats a `true` result
 * as license to skip potentially expensive work (a multi-million-row
 * re-scan, a multi-hour entity populate) — reads outside any transaction
 * are safe here because callers only ever check this after their own
 * schema-catch-up step has already run, by which point `_migrate_progress`
 * reflects every transaction committed by a prior invocation.
 * @param {import('knex').Knex} db
 * @param {string} step
 * @returns {Promise<boolean>}
 */
async function hasCompletedStep(db, step) {
	const row = await db('_migrate_progress').where({ step }).first();
	return row != null;
}

/**
 * The six ref-table sub-populates in the fixed order
 * `populateRefTables` (`packages/@nitpicker/crawler/src/archive/populate-ref-tables/populate-refs.ts`)
 * documents: dictionary tables first, header tables last. Called
 * directly (bypassing that shared orchestrator) so each sub-populate
 * can commit — and checkpoint — independently; `populateRefTables`
 * itself is left unchanged since its other callers rely on it running
 * inside one caller-supplied transaction.
 * @type {{ step: string, run: (trx: import('knex').Knex) => Promise<void> }[]}
 */
const REF_TABLE_STEPS = [
	{ step: 'content_type_refs', run: (trx) => populateContentTypeRefs(trx) },
	{ step: 'url_refs', run: (trx) => populateUrlRefs(trx, logProgress) },
	{ step: 'text_refs', run: (trx) => populateTextRefs(trx, logProgress) },
	{ step: 'json_refs', run: (trx) => populateJsonRefs(trx, logProgress) },
	{ step: 'blob_refs', run: (trx) => populateBlobRefs(trx, logProgress) },
	{ step: 'header_tables', run: (trx) => populateHeaderTables(trx, logProgress) },
];

/**
 * Runs each ref-table sub-populate in its own transaction, skipping any
 * step already recorded as complete in `_migrate_progress`. Every
 * sub-populate is independently idempotent via `INSERT OR IGNORE` on
 * its natural key, so re-running an already-complete step would also
 * be safe — the marker exists purely to skip the (potentially
 * multi-million-row) re-scan on a resumed run, not for correctness.
 * @param {import('knex').Knex} db
 */
async function populateRefTableSteps(db) {
	for (const { step, run } of REF_TABLE_STEPS) {
		if (await hasCompletedStep(db, step)) {
			console.log(`  populate ${step}: already done, skipping`);
			continue;
		}
		await db.transaction(async (trx) => {
			await run(trx);
			await markStepComplete(trx, step);
		});
	}
}

/**
 * Opens the extracted `db.sqlite` and applies every 0.13 migration step:
 * schema catch-up, populate refs, populate entities, verify invariants,
 * retarget + drop legacy tables, and finally bump `info.version` to
 * `0.13.0`.
 *
 * If the legacy tables (`pages` / `resources` / `anchors` / `images`)
 * are already gone — meaning a prior run already reached the drop step
 * before being killed — the legacy-dependent steps (source-column
 * backfill, ref populate, entity populate + verify) are skipped
 * outright rather than attempted: they read from tables that no longer
 * exist and would fail, not silently no-op.
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
		await db.schema.createTableIfNotExists('_migrate_progress', (t) => {
			t.string('step').primary();
			t.string('completed_at').notNullable();
		});

		console.log('  ensure ref tables');
		await migrateRefTables(db);
		console.log('  ensure entity tables');
		await migrateEntityTables(db);
		// Must run before any entity-table data write below: `content_items.
		// dedupe_cap_event_id REFERENCES dedupe_cap_events(id)` (added by
		// `migrateEntityTables` above), and under `PRAGMA foreign_keys = ON`
		// (set above) SQLite refuses to prepare an INSERT/UPDATE against
		// `content_items` at all while the referenced table doesn't exist —
		// not merely a deferred-constraint violation. `createAdjunctTables`
		// is schema-only (`CREATE TABLE IF NOT EXISTS`, no data dependency),
		// so moving it ahead of `populateEntityTables` below is safe; only
		// the later FK *data* retarget (`retargetLegacyFkTables`) genuinely
		// needs `content_items` already populated, and that still runs in
		// its original place after the populate step.
		console.log('  ensure adjunct tables');
		await createAdjunctTables(db);

		// `.every` rather than a single `hasTable('pages')`: the legacy
		// dependent steps below (`ensureLegacySourceColumns`, ref/entity
		// populate) must only run when every legacy table they might touch
		// is confirmed present. `dropLegacyTables` removes all five in one
		// transaction today so partial-drop can't happen in practice, but
		// checking all five (not just `pages`) keeps this guard correct even
		// if a future change splits the drop into separate steps.
		const legacyTablePresence = await Promise.all(
			LEGACY_TABLE_NAMES.map((table) => db.schema.hasTable(table)),
		);
		const legacyTablesPresent = legacyTablePresence.every(Boolean);
		/** @type {import('../packages/@nitpicker/crawler/lib/archive/verify-migration/types.js').MigrationVerificationSummary | undefined} */
		let summary;
		if (legacyTablesPresent) {
			await ensureLegacySourceColumns(db);

			console.log('  populate ref tables');
			await populateRefTableSteps(db);

			console.log('  populate entity tables');
			if (await hasCompletedStep(db, STEP_ENTITY_AND_VERIFY)) {
				console.log(
					'  populate entity tables + verify: already done and already verified, skipping',
				);
			} else {
				const domPathResolver = createDomPathResolver();
				await db.transaction(async (trx) => {
					await populateEntityTables(trx, domPathResolver, logProgress);
					console.log('  verify migration invariants');
					summary = await verifyMigration(trx);
					await markStepComplete(trx, STEP_ENTITY_AND_VERIFY);
				});
				console.log(
					`  verification passed — content_items=${summary.contentItems}, ` +
						`page_meta=${summary.pageMeta}, anchor_edges=${summary.anchorEdges} ` +
						`(sum count=${summary.anchorEdgesSum}), image_items=${summary.imageItems}, ` +
						`resource_items=${summary.resourceItems}`,
				);
			}
		} else {
			console.log(
				'  legacy tables already dropped (resumed past that point) — skipping source-column backfill and ref/entity populate',
			);
		}

		// Retarget under enforcement so the data copy validates every
		// pageId / page_id against content_items row by row.
		if (await hasCompletedStep(db, STEP_RETARGET)) {
			console.log('  retarget adjunct FKs → content_items(id): already done, skipping');
		} else {
			console.log('  retarget adjunct FKs → content_items(id)');
			await db.transaction(async (trx) => {
				await retargetLegacyFkTables(trx);
				await markStepComplete(trx, STEP_RETARGET);
			});
		}

		// The drop runs with enforcement OFF: `pages.redirectDestId` is a
		// self-FK that can fail an enforced DROP TABLE's implicit DELETE on
		// row order, and skipping the implicit DELETE truncates whole
		// b-trees instead of deleting hundreds of thousands of rows one by
		// one. `PRAGMA foreign_keys` cannot change inside a transaction, so
		// this is a separate transaction from the retarget above — safe
		// because the whole mutation happens in the extracted work dir and
		// the output tar is only produced when every step has succeeded.
		// `dropLegacyTables` is `DROP TABLE IF EXISTS`-based, so calling it
		// unconditionally on every run (including ones where the legacy
		// tables are already gone) is safe and cheap.
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

		// Drop the internal checkpoint table now that every DB-level step
		// is done — it must never ship in the output archive. The
		// remaining step (viewer read model build) checkpoints via a
		// work-dir sentinel file instead (see VIEWER_BUILD_COMPLETE_MARKER
		// in main()), not a DB row, precisely so it can still be resumed
		// after this DROP.
		await db.raw('DROP TABLE IF EXISTS _migrate_progress');

		await db.raw('PRAGMA wal_checkpoint(TRUNCATE)');
	} finally {
		await db.destroy();
	}
}

/**
 * Builds the viewer read model against the just-migrated archive so a
 * migrated archive is immediately usable in the viewer's fast path,
 * matching what a live crawl already gets for free at crawl completion
 * (`ensureViewerReadModelQuietly`). Without this step a migrated archive
 * has zero `viewer_*` rows until an operator remembers to run the
 * separate `viewer-build` command — easy to forget, and the archive
 * still opens and "works" in the meantime via the slower legacy path,
 * so there is no error to notice the gap by.
 *
 * Resumes the already-extracted work dir directly via `Archive.resume`
 * (no re-extract — `applyMigrations` already mutated `dbPath` in place)
 * and releases the handle afterward with `releaseHandle()`, NOT
 * `close()`: `close()` tars up and removes the work dir when the
 * archive's derived output path doesn't already exist on disk, which
 * would destroy the very directory `main()`'s own `[3/3] tar` step
 * still needs. `releaseHandle()` only drops the SQLite handle and the
 * advisory lock, touching nothing on disk.
 *
 * Called after `info.version` is already bumped to `0.13.0` — running
 * this any earlier would trip `assertCompatibleVersion`'s version gate
 * on the archive `Archive.resume` opens.
 * @param {string} extractedDir - The archive's extracted work directory
 *   (contains `db.sqlite`), already mutated in place by `applyMigrations`.
 */
async function buildArchiveViewerReadModel(extractedDir) {
	const archive = await Archive.resume(extractedDir);
	try {
		await buildViewerReadModel(archive, {
			onProgress: (progress) => {
				logProgress(`viewer read model: ${progress.insertedRows}/${progress.totalRows}`);
			},
		});
	} finally {
		await archive.releaseHandle();
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
