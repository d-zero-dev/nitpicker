#!/usr/bin/env node
/**
 * Upgrades a 0.10-format `.nitpicker` archive to the Phase 6 write model
 * (issue #103 epic, sub-issue #193). The migration script mirrors the
 * shape of `scripts/migrate-to-0.10.mjs`: extract input → mutate
 * `db.sqlite` inside a work dir → re-tar to a new output path. The
 * original input file is never touched.
 *
 * USAGE
 * -----
 *
 *     node scripts/migrate-to-phase6.mjs <old.nitpicker> [<new.nitpicker>]
 *
 * If <new.nitpicker> is omitted, writes to `<old>.phase6.nitpicker` next
 * to the input.
 *
 * WHAT IT DOES
 * ------------
 *
 * 1. **Phase 6-A/6-C schema catch-up** — creates the ref / header /
 *    entity tables if they are absent. Idempotent via `CREATE TABLE IF
 *    NOT EXISTS`.
 * 2. **Phase 6-B populate** — populates every ref table (url_refs,
 *    text_refs, json_refs, blob_refs, content_type_refs, header_*).
 * 3. **Phase 6-D populate** — populates the six entity / edge tables
 *    (content_items, page_meta, resource_items, anchor_edges,
 *    resource_ref_edges, image_items). All six run inside a single
 *    knex transaction so a failure aborts the whole step; SQLite's WAL
 *    rollback returns the DB to the pre-migration state.
 * 4. **Acceptance verification (Phase 6-E)** — runs all eight invariant
 *    checks from issue #194 against the post-6-D archive. The check
 *    functions live in `packages/@nitpicker/crawler/src/archive/phase6e/`
 *    and the orchestrator `verifyPhase6Migration` chains them in the
 *    order documented there. Verification runs **inside** the same
 *    `knex.transaction()` block that ran the Phase 6-D populate step so
 *    a `Phase6VerificationError` rolls back every 6-D INSERT; ref tables
 *    populated in 6-B stay committed but are additive.
 * 5. **Re-tar** the work dir to the output path.
 *
 * DOM-PATH DERIVATION
 * -------------------
 *
 * `image_items.dom_path_text_id` is derived from `images.sourceCode`
 * against the archived HTML snapshot by parsing each page's HTML with
 * jsdom and applying the 3-case match algorithm from the plan:
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
import { zstdDecompressSync } from 'node:zlib';

import { JSDOM, VirtualConsole } from 'jsdom';
import knex from 'knex';
import * as tar from 'tar';

import { LibsqlDialect } from '../packages/@nitpicker/crawler/lib/archive/libsql-dialect.js';
import { migratePhase6ARefTables } from '../packages/@nitpicker/crawler/lib/archive/migrate-phase6a-ref-tables.js';
import { migratePhase6CEntityTables } from '../packages/@nitpicker/crawler/lib/archive/migrate-phase6c-entity-tables.js';
import { populatePhase6BRefs } from '../packages/@nitpicker/crawler/lib/archive/phase6b/populate-phase6b-refs.js';
import { matchImagesToDomPaths } from '../packages/@nitpicker/crawler/lib/archive/phase6d/match-images-to-dom-paths.js';
import { populatePhase6DEntities } from '../packages/@nitpicker/crawler/lib/archive/phase6d/populate-phase6d-entities.js';
import { verifyPhase6Migration } from '../packages/@nitpicker/crawler/lib/archive/phase6e/verify-phase6-migration.js';

const SQLITE_DB_FILE_NAME = 'db.sqlite';

/**
 * Entry point.
 */
async function main() {
	const [inputArg, outputArg] = process.argv.slice(2);
	if (!inputArg) {
		console.error(
			'Usage: node scripts/migrate-to-phase6.mjs <old.nitpicker> [<new.nitpicker>]',
		);
		process.exit(1);
	}
	const inputPath = path.resolve(inputArg);
	const outputPath = path.resolve(
		outputArg ??
			path.join(
				path.dirname(inputPath),
				`${path.basename(inputPath, path.extname(inputPath))}.phase6.nitpicker`,
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
		`._migrate-phase6-${process.pid}-${path.basename(inputPath, path.extname(inputPath))}`,
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

		console.log('[2/3] apply Phase 6 migrations');
		await applyPhase6Migrations(dbPath);

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
 * Opens the extracted `db.sqlite` and applies every Phase 6 step:
 * schema catch-up (6-A, 6-C), populate refs (6-B), populate entities
 * (6-D). Phase 6-D runs inside a single knex transaction so the whole
 * batch either commits or rolls back.
 * @param {string} dbPath - Path to the extracted `db.sqlite`.
 */
async function applyPhase6Migrations(dbPath) {
	const db = knex({
		client: LibsqlDialect,
		connection: { filename: dbPath },
		useNullAsDefault: true,
	});
	try {
		await db.raw('PRAGMA journal_mode = WAL');
		await db.raw('PRAGMA foreign_keys = ON');

		console.log('  [6-A] ensure ref tables');
		await migratePhase6ARefTables(db);
		console.log('  [6-C] ensure entity tables');
		await migratePhase6CEntityTables(db);

		console.log('  [6-B] populate ref tables');
		await db.transaction(async (trx) => {
			await populatePhase6BRefs(trx);
		});

		console.log('  [6-D] populate entity tables');
		const domPathResolver = createJsdomDomPathResolver();
		const getPageHtml = createHtmlGetter(db);
		/** @type {import('../packages/@nitpicker/crawler/lib/archive/phase6e/types.js').Phase6VerificationSummary} */
		let summary;
		await db.transaction(async (trx) => {
			await populatePhase6DEntities(trx, domPathResolver, getPageHtml);
			console.log('  [6-E] verify 8 acceptance invariants');
			summary = await verifyPhase6Migration(trx);
		});
		console.log(
			`  [6-E] verification passed — content_items=${summary.contentItems}, ` +
				`page_meta=${summary.pageMeta}, anchor_edges=${summary.anchorEdges} ` +
				`(sum count=${summary.anchorEdgesSum}), image_items=${summary.imageItems}, ` +
				`resource_items=${summary.resourceItems}`,
		);

		await db.raw('PRAGMA wal_checkpoint(TRUNCATE)');
	} finally {
		await db.destroy();
	}
}

/**
 * Returns a `PageDomPathResolver` (see
 * `packages/@nitpicker/crawler/src/archive/phase6d/populate-image-items.ts`)
 * that parses HTML with jsdom and applies the 3-case match algorithm from
 * `packages/@nitpicker/crawler/src/archive/phase6d/match-images-to-dom-paths.ts`.
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
			// Every image on this page falls back — the plan requires a
			// per-image warning so operators can audit reconstruction
			// fidelity, not just a single "no HTML for page X" line.
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
 * the audit log satisfies the plan's "record a warning log for every
 * unknown/* fallback" contract. Used when jsdom cannot parse the page
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

/**
 * Builds a `(pageId) => Promise<string | null>` getter that reads the
 * archived HTML BLOB via the `page_html_ref` + `page_html_blobs` join
 * and decompresses via zstd. Analogous to
 * `Database.getHtmlOfPageById` but implemented directly against knex
 * so the migration script does not need to instantiate the full
 * `Database` class (which is a private constructor).
 * @param {import('knex').Knex} db
 */
function createHtmlGetter(db) {
	return async (pageId) => {
		const row = await db('page_html_ref')
			.join('page_html_blobs', 'page_html_ref.hash', '=', 'page_html_blobs.hash')
			.select('page_html_blobs.body as body', 'page_html_blobs.codec as codec')
			.where('page_html_ref.page_id', pageId)
			.first();
		if (!row) return null;
		return decodeStoredBlob(row.body, row.codec);
	};
}

/**
 * Decompresses one `page_html_blobs.body` value into UTF-8 text.
 * Mirrors the `codec` union from `init-schema.ts` — only `zstd` and
 * `none` are valid; anything else is a corrupt archive.
 * @param {Uint8Array} body
 * @param {string} codec
 * @returns {string}
 */
function decodeStoredBlob(body, codec) {
	const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
	if (codec === 'zstd') {
		return zstdDecompressSync(buffer).toString('utf8');
	}
	if (codec === 'none') {
		return buffer.toString('utf8');
	}
	throw new Error(`Unknown page_html_blobs.codec: ${codec}`);
}

try {
	await main();
} catch (error) {
	console.error(error);
	process.exit(1);
}
