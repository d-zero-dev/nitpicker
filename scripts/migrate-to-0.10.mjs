#!/usr/bin/env node
/**
 * Upgrades a pre-0.10 `.nitpicker` archive in place to the 0.10 format that
 * the current build accepts (`assertCompatibleVersion` requires
 * `info.version >= "0.10.0"`).
 *
 * 0.10 format is the cumulative result of #84 (HTML stored as
 * zstd-compressed BLOBs in `page_html_blobs` + `page_html_ref`, replacing
 * `snapshot-html.zip` + `pages.html` path strings) and #85 (pages-table
 * meta columns reshaped around beholder 3.0.0's nested `Meta`, plus new
 * `page_tags` / `page_jsonld` tables, `meta_extras` JSON catch-all, and
 * denormalised aggregates).
 *
 * USAGE
 * -----
 *
 *     node scripts/migrate-to-0.10.mjs <old.nitpicker> [<new.nitpicker>]
 *
 * If <new.nitpicker> is omitted, writes to `<old>.0.10.nitpicker` next to
 * the input. The original file is never modified or deleted.
 *
 * NOTES
 * -----
 *
 * - **State-detect**: the script inspects the input and runs only the
 *   steps that are still needed:
 *   - Step A (html→blob): runs when `snapshot-html.zip` or `snapshot-html/`
 *     is present in the tar OR when `pages.html` column exists.
 *   - Step B (meta schema): runs when `pages.meta_extras` column is missing.
 *   - Step C (meta backfill): runs **unconditionally after A/B succeed**.
 *     Each page's HTML BLOB is jsdom-parsed, fed through beholder 3.1.0's
 *     `extractMetaFromDocument`, and the resulting `Meta` is persisted to
 *     the 0.10 columns + `page_tags` + `page_jsonld` via the same archive-
 *     side derivation helpers the live crawler uses. Overwrite-safe;
 *     idempotency comes from `DELETE` + `INSERT` per page rather than a
 *     marker column.
 *   - Both A and B already done → the script exits early with "already
 *     0.10" without running C (this branch is the "the migration completed
 *     last time" guard, not a refresh path).
 * - **Single-shot**: on any failure, the partial output is removed and the
 *   work dir is cleaned up. Re-run from scratch — there is no resume.
 * - **Streaming**: Step A reads HTML rows in chunks, hashed + compressed +
 *   inserted in small per-chunk transactions to bound memory and WAL on
 *   100k-page / multi-GB archives.
 * - **info.version bump**: after the schema migrations, the script writes
 *   `info.version = '0.10.0'` so the next CLI open passes
 *   `assertCompatibleVersion`.
 * - **v0.x**: no read-side compatibility with the legacy layout, hence
 *   this script. Not shipped in the npm package; obtain via `git clone`.
 */

/* eslint-disable no-console, import-x/no-extraneous-dependencies */

import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

import { extractMetaFromDocument } from '@d-zero/beholder';
import { extractZip } from '@d-zero/fs/zip';
import { JSDOM, VirtualConsole } from 'jsdom';
import libsqlPkg from 'libsql';
import * as tar from 'tar';

import { classifyJsonLdType } from '../packages/@nitpicker/crawler/lib/archive/meta/classify-jsonld-type.js';
import { computePageDenormalized } from '../packages/@nitpicker/crawler/lib/archive/meta/compute-page-denormalized.js';
import { deriveFlatFromMeta } from '../packages/@nitpicker/crawler/lib/archive/meta/derive-flat-from-meta.js';
import { deriveMetaExtras } from '../packages/@nitpicker/crawler/lib/archive/meta/derive-meta-extras.js';
import { extractTagsForArchive } from '../packages/@nitpicker/crawler/lib/archive/meta/extract-tags-for-archive.js';

const Database = libsqlPkg.default ?? libsqlPkg;

const SQLITE_DB_FILE_NAME = 'db.sqlite';
const SNAPSHOT_HTML_DIR = 'snapshot-html';
const TARGET_FORMAT_VERSION = '0.10.0';

/**
 * Chunk size for the streaming Step-A migration loop. Sized to keep three
 * pressures balanced:
 *
 * - **Memory**: one chunk's HTML bodies are buffered in RAM
 *   simultaneously (~500 × ~75 KB ≈ 35 MB for a typical site crawl). A
 *   larger chunk risks OOMs on the 7+ GB archives the script was written
 *   for.
 * - **WAL bound**: each chunk commits in its own SQLite transaction +
 *   PASSIVE checkpoint, so the WAL stays well under 100 MB even for
 *   100k-row migrations.
 * - **Progress visibility**: a chunk completes every few seconds on a
 *   modern laptop, giving the operator a steady stream of feedback.
 */
const CHUNK_SIZE = 500;

/**
 * Entry point. Parses argv and runs the migration end-to-end.
 */
async function main() {
	const [inputArg, outputArg] = process.argv.slice(2);
	if (!inputArg) {
		console.error(
			'Usage: node scripts/migrate-to-0.10.mjs <old.nitpicker> [<new.nitpicker>]',
		);
		process.exit(1);
	}
	const inputPath = path.resolve(inputArg);
	const outputPath = path.resolve(
		outputArg ??
			path.join(
				path.dirname(inputPath),
				`${path.basename(inputPath, path.extname(inputPath))}.0.10.nitpicker`,
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
		`._migrate-${process.pid}-${path.basename(inputPath, path.extname(inputPath))}`,
	);
	if (existsSync(workDir)) {
		console.error(`Stale work dir present: ${workDir} — remove it first`);
		process.exit(1);
	}
	mkdirSync(workDir, { recursive: true });

	try {
		console.log(`[1/3] untar ${inputPath} -> ${workDir}`);
		await tar.x({ file: inputPath, cwd: workDir });

		// Find the top-level directory created by untar. The tar's inner
		// directory name was baked in by `Archive.write()` at create time
		// and may not match the outer filename if the user renamed the
		// `.nitpicker` after the fact — so we discover it from the work
		// dir instead of computing it from `inputPath`.
		const innerDirName = findInnerDir(workDir);
		const extractedDir = path.join(workDir, innerDirName);
		const dbPath = path.join(extractedDir, SQLITE_DB_FILE_NAME);
		const zipPath = path.join(extractedDir, `${SNAPSHOT_HTML_DIR}.zip`);
		const looseDir = path.join(extractedDir, SNAPSHOT_HTML_DIR);
		if (!existsSync(dbPath)) {
			throw new Error(`Missing ${SQLITE_DB_FILE_NAME} in input archive`);
		}

		console.log('[2/3] rewrite db.sqlite');
		await rewriteDatabase(dbPath, zipPath, looseDir);

		// Remove the legacy layout artifacts so the re-tarred archive is
		// clean (no snapshot-html/, no snapshot-html.zip). Skip when Step A
		// did not run (zip / loose dir were absent to begin with).
		if (existsSync(zipPath)) rmSync(zipPath, { force: true });
		if (existsSync(looseDir)) rmSync(looseDir, { recursive: true, force: true });
		// libsql leaves -wal / -shm sidecars after close even after a
		// TRUNCATE checkpoint. They are zero-byte / mostly-empty but tar
		// would still include them; remove for a clean output archive.
		for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
			if (existsSync(sidecar)) rmSync(sidecar, { force: true });
		}

		console.log(`[3/3] tar -> ${outputPath}`);
		await tar.c({ file: outputPath, cwd: workDir, portable: true }, [innerDirName]);

		console.log('Done.');
	} catch (error) {
		// Best-effort cleanup of partial output so the next run sees a clean slate.
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
 * Skips macOS AppleDouble (`._*`) sidecar files that BSD tar embeds and
 * Node's `tar` library surfaces verbatim.
 * @param {string} workDir
 * @returns {string} Inner directory name (just the basename, not the full path).
 * @throws {Error} If no directory is found, or more than one candidate exists.
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
			`Untar produced multiple top-level directories inside ${workDir}: ${candidates.join(', ')}. ` +
				`A Nitpicker archive should contain exactly one.`,
		);
	}
	return candidates[0];
}

/**
 * Drives both upgrade steps against the open database. Each step runs only
 * when the on-disk state still needs it; the function exits early when the
 * archive is already at 0.10.
 * @param {string} dbPath - Path to `db.sqlite` inside the work dir.
 * @param {string} zipPath - Path to the legacy `snapshot-html.zip`.
 * @param {string} looseDir - Path to the legacy `snapshot-html/`.
 */
async function rewriteDatabase(dbPath, zipPath, looseDir) {
	const db = new Database(dbPath);
	try {
		db.exec('PRAGMA journal_mode = WAL');
		db.exec('PRAGMA foreign_keys = ON');

		const needsStepA = stepANeeded(db, zipPath, looseDir);
		const needsStepB = stepBNeeded(db);

		if (!needsStepA && !needsStepB && infoVersionAtLeast(db, TARGET_FORMAT_VERSION)) {
			throw new Error(
				`Archive is already at ${TARGET_FORMAT_VERSION} (page_html_blobs populated, ` +
					`pages.meta_extras present, info.version >= ${TARGET_FORMAT_VERSION}). ` +
					`Nothing to do.`,
			);
		}

		if (needsStepA) {
			console.log('  [Step A] HTML → BLOB storage');
			ensureBlobTables(db);
			await migrateHtmlToBlob(db, zipPath, looseDir);
		} else {
			console.log('  [Step A] skipped (already migrated)');
		}

		if (needsStepB) {
			console.log(
				'  [Step B] meta schema upgrade (pages columns + page_tags / page_jsonld)',
			);
			migrateMetaSchema(db);
		} else {
			console.log('  [Step B] skipped (meta_extras column already present)');
		}

		console.log('  [Step C] meta backfill (HTML → jsdom → beholder Meta → 0.10 columns)');
		await backfillMeta(db);

		console.log(`  bumping info.version → ${TARGET_FORMAT_VERSION}`);
		bumpInfoVersion(db, TARGET_FORMAT_VERSION);

		db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
	} finally {
		db.close();
	}
}

/**
 * Decides whether Step A (html→blob) is still needed. Step A is needed
 * when the archive carries either of the legacy artifacts that #84 retired:
 * the `snapshot-html.zip` / `snapshot-html/` payload, OR the `pages.html`
 * column. If both are gone, the archive is already post-#84.
 * @param {InstanceType<typeof Database>} db
 * @param {string} zipPath
 * @param {string} looseDir
 */
function stepANeeded(db, zipPath, looseDir) {
	const hasZip = existsSync(zipPath);
	const hasLoose = existsSync(looseDir);
	const hasHtmlColumn = columnExists(db, 'pages', 'html');
	return hasZip || hasLoose || hasHtmlColumn;
}

/**
 * Decides whether Step B (meta schema upgrade) is still needed. Step B
 * is needed when `pages.meta_extras` is missing — the marker column #85
 * added.
 * @param {InstanceType<typeof Database>} db
 */
function stepBNeeded(db) {
	return !columnExists(db, 'pages', 'meta_extras');
}

/**
 * Step A: reads the legacy `pages.html` path strings in chunks, resolves
 * each body from the snapshot zip / loose dir, hashes + compresses, inserts
 * into `page_html_blobs` + `page_html_ref`, then drops the legacy column.
 * @param {InstanceType<typeof Database>} db
 * @param {string} zipPath
 * @param {string} looseDir
 */
async function migrateHtmlToBlob(db, zipPath, looseDir) {
	const refRows = db.prepare('SELECT COUNT(*) AS n FROM page_html_ref').get();
	if (refRows && Number(refRows.n) > 0) {
		// page_html_ref already populated but pages.html still exists →
		// previous run was interrupted mid-Step-A. Refuse rather than
		// double-insert and risk an inconsistent ref count.
		throw new Error(
			`page_html_ref already contains ${refRows.n} rows but pages.html is still present. ` +
				`Re-extract the original .nitpicker and re-run from scratch.`,
		);
	}

	const lookup = await buildBodyLookup(zipPath, looseDir);

	const totalRow = db
		.prepare("SELECT COUNT(*) AS n FROM pages WHERE html IS NOT NULL AND html != ''")
		.get();
	const total = Number(totalRow?.n ?? 0);
	console.log(`    ${total} rows to migrate`);

	const selectChunk = db.prepare(
		"SELECT id, html FROM pages WHERE html IS NOT NULL AND html != '' AND id > ? ORDER BY id LIMIT ?",
	);
	const insertBlob = db.prepare(
		'INSERT INTO page_html_blobs(hash, body, codec, size_raw, size_stored) ' +
			'VALUES (?, ?, ?, ?, ?) ON CONFLICT(hash) DO NOTHING',
	);
	const insertRef = db.prepare('INSERT INTO page_html_ref(page_id, hash) VALUES (?, ?)');

	let processed = 0;
	let lastId = 0;
	while (true) {
		const rows = selectChunk.all(lastId, CHUNK_SIZE);
		if (rows.length === 0) {
			break;
		}
		// Resolve bodies (async — zip entry buffers) BEFORE entering
		// the sync transaction; once inside, no awaits.
		const resolved = [];
		for (const row of rows) {
			const rel = normaliseRelPath(row.html);
			const resolver = lookup.get(rel);
			if (!resolver) {
				console.warn(
					`    [skip] page id=${row.id}: body "${rel}" not found in zip or loose dir`,
				);
				continue;
			}
			resolved.push({ id: row.id, body: await resolver() });
		}
		db.transaction(() => {
			for (const { id, body } of resolved) {
				const hash = createHash('sha256').update(body).digest();
				const compressed = zstdCompressSync(body);
				insertBlob.run(hash, compressed, 'zstd', body.byteLength, compressed.byteLength);
				insertRef.run(id, hash);
			}
		})();
		processed += rows.length;
		lastId = rows.at(-1).id;
		console.log(`    [${processed}/${total}] processed`);
		// Keep the WAL bounded across the run.
		db.exec('PRAGMA wal_checkpoint(PASSIVE)');
	}

	db.exec('ALTER TABLE pages DROP COLUMN html');
}

/**
 * Step B: reshapes the `pages` table to the 0.10 meta schema, then creates
 * the empty `page_tags` / `page_jsonld` tables that #85 introduced.
 *
 * Schema operations applied in order:
 *
 * 1. `ADD COLUMN` for ~40 new flat meta columns (`dir`, `charset`,
 *    `themeColor`, OGP sub-fields, Twitter sub-fields, robots additions,
 *    timestamps, denormalised aggregates, `meta_extras` JSON, …).
 * 2. `RENAME COLUMN` for `noindex → robots_noindex`,
 *    `nofollow → robots_nofollow`, `noarchive → robots_noarchive`.
 * 3. `DROP COLUMN alternate` (no longer in the 0.10 schema; pre-existing
 *    values are lost — #85 plan accepted this).
 * 4. `CREATE TABLE page_tags` + indexes (Wappalyzer tags), empty.
 * 5. `CREATE TABLE page_jsonld` + indexes (JSON-LD / SpeculationRules), empty.
 * 6. `CREATE INDEX` on `pages(robots_noindex)` and `pages(og_type)`.
 *
 * Each `ALTER TABLE` is run with `IF NOT EXISTS`-style guards (via
 * pre-check `columnExists`) so the step is safe to re-run after a partial
 * failure.
 * @param {InstanceType<typeof Database>} db
 */
function migrateMetaSchema(db) {
	const addColumns = [
		// Document basics
		['dir', 'TEXT'],
		['charset', 'TEXT'],
		['baseHref', 'TEXT'],
		['viewport_raw', 'TEXT'],
		['themeColor', 'TEXT'],
		['applicationName', 'TEXT'],
		['author', 'TEXT'],
		['generator', 'TEXT'],
		['publisher', 'TEXT'],
		// Robots additions
		['robots_raw', 'TEXT'],
		['robots_noimageindex', 'INTEGER'],
		['googlebot', 'TEXT'],
		// Link
		['amphtml', 'TEXT'],
		['manifest', 'TEXT'],
		['icon_href', 'TEXT'],
		['appleTouchIcon_href', 'TEXT'],
		// Open Graph sub-fields
		['og_image_alt', 'TEXT'],
		['og_image_width', 'TEXT'],
		['og_image_height', 'TEXT'],
		['og_locale', 'TEXT'],
		['og_article_published_time', 'TEXT'],
		['og_article_modified_time', 'TEXT'],
		// Twitter sub-fields
		['twitter_site', 'TEXT'],
		['twitter_creator', 'TEXT'],
		['twitter_title', 'TEXT'],
		['twitter_description', 'TEXT'],
		['twitter_image', 'TEXT'],
		// One-offs
		['fb_app_id', 'TEXT'],
		['verification_google', 'TEXT'],
		['formatDetection_telephone', 'INTEGER'],
		// Timestamps (UNIX ms)
		['firstCrawledAt', 'INTEGER'],
		['lastCrawledAt', 'INTEGER'],
		// Denormalised aggregates
		['tag_count', 'INTEGER'],
		['jsonld_count', 'INTEGER'],
		['tags_providers_csv', 'TEXT'],
		// Catch-all JSON
		['meta_extras', 'TEXT'],
	];
	for (const [name, type] of addColumns) {
		if (columnExists(db, 'pages', name)) continue;
		db.exec(`ALTER TABLE pages ADD COLUMN ${name} ${type}`);
	}

	const renames = [
		['noindex', 'robots_noindex'],
		['nofollow', 'robots_nofollow'],
		['noarchive', 'robots_noarchive'],
	];
	for (const [from, to] of renames) {
		if (!columnExists(db, 'pages', from)) continue;
		if (columnExists(db, 'pages', to)) continue;
		db.exec(`ALTER TABLE pages RENAME COLUMN ${from} TO ${to}`);
	}

	if (columnExists(db, 'pages', 'alternate')) {
		db.exec('ALTER TABLE pages DROP COLUMN alternate');
	}

	if (!tableExists(db, 'page_tags')) {
		db.exec(`
			CREATE TABLE page_tags (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				pageId      INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
				provider    TEXT NOT NULL,
				category    TEXT,
				externalId  TEXT,
				version     TEXT,
				confidence  INTEGER,
				categories  TEXT,
				sources     TEXT
			)
		`);
		db.exec('CREATE INDEX page_tags_pageId ON page_tags(pageId)');
		db.exec('CREATE INDEX page_tags_provider ON page_tags(provider)');
		db.exec('CREATE INDEX page_tags_externalId ON page_tags(externalId)');
		db.exec('CREATE INDEX page_tags_provider_extId ON page_tags(provider, externalId)');
		db.exec('CREATE INDEX page_tags_provider_pageId ON page_tags(provider, pageId)');
	}
	if (!tableExists(db, 'page_jsonld')) {
		db.exec(`
			CREATE TABLE page_jsonld (
				id          INTEGER PRIMARY KEY AUTOINCREMENT,
				pageId      INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
				kind        TEXT NOT NULL,
				type        TEXT,
				raw         TEXT NOT NULL,
				parsed      TEXT,
				parseError  TEXT
			)
		`);
		db.exec('CREATE INDEX page_jsonld_pageId ON page_jsonld(pageId)');
		db.exec('CREATE INDEX page_jsonld_type ON page_jsonld(type)');
		db.exec('CREATE INDEX page_jsonld_type_pageId ON page_jsonld(type, pageId)');
	}

	if (!indexExists(db, 'pages_robots_noindex_index')) {
		db.exec('CREATE INDEX pages_robots_noindex_index ON pages(robots_noindex)');
	}
	if (!indexExists(db, 'pages_og_type_index')) {
		db.exec('CREATE INDEX pages_og_type_index ON pages(og_type)');
	}
}

/**
 * Step C: backfills the 0.10 meta columns (`lang`, `og_*`, `twitter_*`,
 * `robots_*`, `meta_extras`, denormalised aggregates) plus the `page_tags`
 * and `page_jsonld` tables for every scraped page that has an HTML BLOB.
 *
 * Why this step exists: Step B only reshapes the schema — the new columns
 * stay `NULL` and the new tables stay empty unless something derives values
 * for them. Without backfill, a migrated archive would open cleanly but
 * read paths (`get-page-detail`, Sheets reports, viewer Meta panels) would
 * surface empty values for every legacy page. Step C closes the gap so a
 * migrated archive is functionally identical to one freshly crawled under
 * 0.10.
 *
 * Pipeline per page:
 *
 * 1. Decompress the HTML BLOB (zstd or none).
 * 2. Parse with `JSDOM(html, { url })` — script execution is **off** by
 *    default; archived HTML is the post-render output, so no script
 *    execution is required to read meta tags.
 * 3. Hand the window to `extractMetaFromDocument` (beholder 3.1.0's
 *    Puppeteer-free entry point). It runs the same `collectHead → detectTags
 *    → classify` pipeline as the live `Scraper`, so the resulting `Meta` is
 *    bit-equivalent to a fresh crawl.
 * 4. Run the same archive-side derivation helpers the runtime uses
 *    (`deriveFlatFromMeta`, `computePageDenormalized`, `deriveMetaExtras`,
 *    `extractTagsForArchive`, `classifyJsonLdType`) so column shapes match
 *    1:1 with crawler output.
 * 5. Inside a per-chunk transaction: `UPDATE pages SET …`, then `DELETE` +
 *    `INSERT` the page's `page_tags` / `page_jsonld` rows so the result is
 *    overwrite-safe (re-running the script always produces the same state).
 *
 * **Failure isolation**: a JSDOM parse error or extractMetaFromDocument
 * throw on one page is logged and the page is skipped; the rest of the run
 * completes. The migrated archive will simply carry NULL meta for that page
 * (no worse than not running Step C at all).
 *
 * **Performance**: per-page sequential. jsdom + Wappalyzer is CPU-bound and
 * each page takes ~50–200 ms; 100k pages takes hours. Acceptable because
 * this is a one-shot migration step and the user explicitly chose
 * faithfulness over throughput.
 * @param {InstanceType<typeof Database>} db
 */
async function backfillMeta(db) {
	const totalRow = db
		.prepare(
			'SELECT COUNT(*) AS n FROM pages p ' +
				'JOIN page_html_ref r ON r.page_id = p.id ' +
				'WHERE p.scraped = 1',
		)
		.get();
	const total = Number(totalRow?.n ?? 0);
	console.log(`    ${total} pages to backfill`);
	if (total === 0) return;

	const selectChunk = db.prepare(
		'SELECT p.id, p.url, p.status, p.responseHeaders, ' +
			'b.body AS html_body, b.codec AS html_codec ' +
			'FROM pages p ' +
			'JOIN page_html_ref r ON r.page_id = p.id ' +
			'JOIN page_html_blobs b ON b.hash = r.hash ' +
			'WHERE p.scraped = 1 AND p.id > ? ' +
			'ORDER BY p.id LIMIT ?',
	);
	const updatePage = db.prepare(buildUpdatePageStatement());
	const deletePageTags = db.prepare('DELETE FROM page_tags WHERE pageId = ?');
	const insertPageTag = db.prepare(
		'INSERT INTO page_tags(pageId, provider, category, externalId, version, confidence, categories, sources) ' +
			'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
	);
	const deletePageJsonld = db.prepare('DELETE FROM page_jsonld WHERE pageId = ?');
	const insertPageJsonld = db.prepare(
		'INSERT INTO page_jsonld(pageId, kind, type, raw, parsed, parseError) VALUES (?, ?, ?, ?, ?, ?)',
	);

	let processed = 0;
	let skipped = 0;
	let lastId = 0;
	while (true) {
		const rows = selectChunk.all(lastId, CHUNK_SIZE);
		if (rows.length === 0) break;

		// Derive Meta outside the transaction — JSDOM + Wappalyzer are
		// async and SQLite transactions in libsql must not span awaits.
		const derived = [];
		for (const row of rows) {
			try {
				const html = decompressBody(row.html_body, row.html_codec);
				const meta = await extractMetaForRow(row, html);
				derived.push(buildDerivation(row, meta));
			} catch (error) {
				skipped++;
				console.warn(`    [skip] page id=${row.id} (${row.url}): ${error.message}`);
			}
		}

		db.transaction(() => {
			for (const d of derived) {
				updatePage.run(...d.pageUpdateParams);
				deletePageTags.run(d.pageId);
				for (const tag of d.tagRows) {
					insertPageTag.run(
						d.pageId,
						tag.provider,
						tag.category,
						tag.externalId,
						tag.version,
						tag.confidence,
						JSON.stringify(tag.categories),
						JSON.stringify(tag.sources),
					);
				}
				deletePageJsonld.run(d.pageId);
				for (const jl of d.jsonldRows) {
					insertPageJsonld.run(
						d.pageId,
						jl.kind,
						jl.type,
						jl.raw,
						jl.parsed === null ? null : JSON.stringify(jl.parsed),
						jl.parseError,
					);
				}
			}
		})();

		processed += rows.length;
		lastId = rows.at(-1).id;
		console.log(`    [${processed}/${total}] processed (skipped: ${skipped})`);
		db.exec('PRAGMA wal_checkpoint(PASSIVE)');
	}
	if (skipped > 0) {
		console.warn(`    Step C: ${skipped} page(s) skipped due to parse / extract errors`);
	}
}

/**
 * Parses one page's stored response headers (JSON in legacy column) into
 * the shape `extractMetaFromDocument` expects. Defensive against legacy
 * archives where the column is `null` or stores an unparseable string.
 * @param {string | null} stored
 * @returns {Record<string, string | string[] | undefined>}
 */
function parseStoredHeaders(stored) {
	if (typeof stored !== 'string' || stored === '') return {};
	try {
		const parsed = JSON.parse(stored);
		// `typeof [] === 'object'` in JS, so guard against arrays — a
		// legacy archive carrying a malformed `[...]` JSON for headers
		// would otherwise be forwarded as-is to Wappalyzer, which expects
		// a Record-shaped value and treats array indices as header names.
		if (parsed === null) return {};
		if (typeof parsed !== 'object') return {};
		if (Array.isArray(parsed)) return {};
		return parsed;
	} catch {
		return {};
	}
}

/**
 * Decompresses a stored HTML body BLOB back to a UTF-8 string. The migration
 * script accepts both `zstd` (current codec) and `none` (escape hatch) so a
 * pre-#84 archive that already passed Step A in a previous partial run is
 * still readable.
 * @param {Buffer | Uint8Array} body
 * @param {string} codec
 * @returns {string}
 */
function decompressBody(body, codec) {
	const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
	if (codec === 'zstd') return zstdDecompressSync(buf).toString('utf8');
	if (codec === 'none') return buf.toString('utf8');
	throw new Error(`Unknown HTML codec: ${codec}`);
}

/**
 * Builds a jsdom Window over `html` and hands it to beholder's
 * `extractMetaFromDocument`. JSDOM constructor and the
 * `extractMetaFromDocument` call together encapsulate the per-page work that
 * cannot share state with other pages.
 *
 * `VirtualConsole` is muted because archived HTML often contains broken
 * inline scripts / malformed CSS that jsdom would otherwise spam to stderr
 * for every legacy page. Errors that actually matter (extract failure)
 * surface via the try/catch in `backfillMeta`.
 * @param {{id: number, url: string, status: number | null, responseHeaders: string | null}} row
 * @param {string} html
 * @returns {Promise<import('@d-zero/beholder').Meta>}
 */
async function extractMetaForRow(row, html) {
	const virtualConsole = new VirtualConsole(); // no-op default sinks all messages
	const dom = new JSDOM(html, { url: row.url, virtualConsole });
	try {
		return await extractMetaFromDocument(/** @type {Window} */ (dom.window), {
			url: row.url,
			html,
			statusCode: row.status ?? undefined,
			headers: parseStoredHeaders(row.responseHeaders),
		});
	} finally {
		// Release jsdom's internal references so the per-page allocation
		// is GC-able before the next iteration. Critical for 100k-page runs.
		dom.window.close();
	}
}

/**
 * Maps a beholder `Meta` to the SQL bind values used by the per-page
 * UPDATE / INSERT triplet. Centralising the column-order math here keeps
 * `buildUpdatePageStatement` and `backfillMeta` in lock-step — change the
 * column list in one place and the bind order follows.
 * @param {{id: number, url: string}} row
 * @param {import('@d-zero/beholder').Meta} meta
 */
function buildDerivation(row, meta) {
	const flat = deriveFlatFromMeta(meta, row.url);
	const denorm = computePageDenormalized(meta);
	const extras = deriveMetaExtras(meta);
	const tagRows = extractTagsForArchive(meta.tags);
	const jsonldRows = [
		...(meta.jsonLd ?? []).map((entry) => ({
			kind: 'ld+json',
			type: classifyJsonLdType(entry),
			raw: entry.raw,
			parsed: entry.parsed ?? null,
			parseError: entry.parseError ?? null,
		})),
		...(meta.speculationRules ?? []).map((entry) => ({
			kind: 'speculationrules',
			type: classifyJsonLdType(entry),
			raw: entry.raw,
			parsed: entry.parsed ?? null,
			parseError: entry.parseError ?? null,
		})),
	];
	const pageUpdateParams = [
		...PAGE_FLAT_COLUMNS.map((name) => flat[name]),
		denorm.tag_count,
		denorm.jsonld_count,
		denorm.tags_providers_csv,
		JSON.stringify(extras),
		row.id,
	];
	return { pageId: row.id, pageUpdateParams, tagRows, jsonldRows };
}

/**
 * Static list of `pages` flat columns written by Step C. Drives the SQL
 * UPDATE statement and the bind-order math in `buildDerivation`.
 *
 * Mirrors {@link FlatPageMetaColumns} from
 * `packages/@nitpicker/crawler/src/archive/meta/types.ts`. When the
 * crawler's `FlatPageMetaColumns` grows a field, add it here AND to
 * `migrateMetaSchema`'s `ADD COLUMN` list so a freshly-migrated archive
 * carries it.
 */
const PAGE_FLAT_COLUMNS = [
	'lang',
	'dir',
	'charset',
	'baseHref',
	'viewport_raw',
	'themeColor',
	'applicationName',
	'author',
	'generator',
	'publisher',
	'robots_raw',
	'robots_noindex',
	'robots_nofollow',
	'robots_noarchive',
	'robots_noimageindex',
	'googlebot',
	'canonical',
	'amphtml',
	'manifest',
	'icon_href',
	'appleTouchIcon_href',
	'og_type',
	'og_title',
	'og_url',
	'og_site_name',
	'og_description',
	'og_image',
	'og_image_alt',
	'og_image_width',
	'og_image_height',
	'og_locale',
	'og_article_published_time',
	'og_article_modified_time',
	'twitter_card',
	'twitter_site',
	'twitter_creator',
	'twitter_title',
	'twitter_description',
	'twitter_image',
	'fb_app_id',
	'verification_google',
	'formatDetection_telephone',
	'title',
	'description',
	'keywords',
];

/**
 * Builds the parameterised UPDATE SQL for one page row. All flat meta
 * columns + the three denormalised aggregates + `meta_extras` are written;
 * `id` is the WHERE-clause bind. Order must stay in lock-step with
 * `buildDerivation`'s `pageUpdateParams` array.
 * @returns {string}
 */
function buildUpdatePageStatement() {
	const assignments = [
		...PAGE_FLAT_COLUMNS.map((c) => `${c} = ?`),
		'tag_count = ?',
		'jsonld_count = ?',
		'tags_providers_csv = ?',
		'meta_extras = ?',
	].join(', ');
	return `UPDATE pages SET ${assignments} WHERE id = ?`;
}

/**
 * Writes `info.version = TARGET_FORMAT_VERSION` so the next CLI open
 * passes `assertCompatibleVersion`. The script does not touch any other
 * info column — only the version field, which is the sole signal the
 * runtime reads.
 * @param {InstanceType<typeof Database>} db
 * @param {string} version
 */
function bumpInfoVersion(db, version) {
	const exists = tableExists(db, 'info');
	if (!exists) {
		// Defensive: a corrupted archive without an info table can't be
		// rescued by version bump alone. The runtime would treat it as a
		// brand-new archive (initSchema fills it in), so leave it alone.
		return;
	}
	const result = db.prepare('UPDATE info SET version = ?').run(version);
	if (result.changes === 0) {
		// Info table exists but has zero rows — extremely rare (legitimate
		// archives always have one row written by `setConfig`). Without this
		// fallback the produced `.0.10.nitpicker` would still carry
		// `info.version IS NULL` and `assertCompatibleVersion` would
		// re-reject it.
		db.prepare('INSERT INTO info(version) VALUES (?)').run(version);
	}
}

/**
 * Returns the major.minor.patch of `info.version` as an array, defaulting
 * missing components to 0 and non-numeric components to 0. Used by
 * {@link infoVersionAtLeast} to keep idempotency check side-effect-free.
 * @param {InstanceType<typeof Database>} db
 * @returns {[number, number, number]}
 */
function readInfoVersion(db) {
	if (!tableExists(db, 'info')) return [0, 0, 0];
	const row = db.prepare('SELECT version FROM info').get();
	const raw = typeof row?.version === 'string' ? row.version : '';
	const core = raw.split(/[-+]/)[0] ?? '';
	const parts = core.split('.');
	const components = parts.slice(0, 3).map((p) => {
		const n = Number.parseInt(p, 10);
		return Number.isFinite(n) ? n : 0;
	});
	while (components.length < 3) components.push(0);
	return /** @type {[number, number, number]} */ (components);
}

/**
 * Whether `info.version` is already at-or-newer than `target`.
 * @param {InstanceType<typeof Database>} db
 * @param {string} target - Target semver (e.g. `'0.10.0'`).
 */
function infoVersionAtLeast(db, target) {
	const [aMa, aMi, aPa] = readInfoVersion(db);
	const targetComponents = target.split(/[-+]/)[0].split('.');
	const [tMa, tMi, tPa] = [
		Number.parseInt(targetComponents[0] ?? '0', 10),
		Number.parseInt(targetComponents[1] ?? '0', 10),
		Number.parseInt(targetComponents[2] ?? '0', 10),
	];
	if (aMa !== tMa) return aMa > tMa;
	if (aMi !== tMi) return aMi > tMi;
	return aPa >= tPa;
}

/**
 * Creates the BLOB tables and index if not already present. Mirrors the
 * runtime `init-schema.ts` so an archive whose runtime schema-migration
 * never ran can still be finalised by this script.
 * @param {InstanceType<typeof Database>} db
 */
function ensureBlobTables(db) {
	if (tableExists(db, 'page_html_blobs')) return;
	db.exec(`
		CREATE TABLE page_html_blobs (
			hash         BLOB PRIMARY KEY,
			body         BLOB NOT NULL,
			codec        TEXT NOT NULL CHECK(codec IN ('zstd', 'none')),
			size_raw     INTEGER NOT NULL,
			size_stored  INTEGER NOT NULL
		) WITHOUT ROWID
	`);
	db.exec(`
		CREATE TABLE page_html_ref (
			page_id  INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
			hash     BLOB NOT NULL REFERENCES page_html_blobs(hash)
		) WITHOUT ROWID
	`);
	db.exec('CREATE INDEX idx_page_html_ref_hash ON page_html_ref(hash)');
}

/**
 * Returns true if `table` has a column named `column`.
 * @param {InstanceType<typeof Database>} db
 * @param {string} table
 * @param {string} column
 * @returns {boolean}
 */
function columnExists(db, table, column) {
	const rows = db.prepare(`PRAGMA table_info(${table})`).all();
	return rows.some((r) => r.name === column);
}

/**
 * Returns true if the named table exists in the database.
 * @param {InstanceType<typeof Database>} db
 * @param {string} table
 * @returns {boolean}
 */
function tableExists(db, table) {
	const row = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
		.get(table);
	return Boolean(row);
}

/**
 * Returns true if the named index exists in the database.
 * @param {InstanceType<typeof Database>} db
 * @param {string} indexName
 * @returns {boolean}
 */
function indexExists(db, indexName) {
	const row = db
		.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
		.get(indexName);
	return Boolean(row);
}

/**
 * Builds the relative-path → body-resolver lookup that spans the loose
 * `snapshot-html/` directory and the `snapshot-html.zip` central
 * directory. The loose dir wins on collision (an interrupted
 * `Archive.write()` could have updated the dir but not yet rewritten the
 * zip).
 * @param {string} zipPath
 * @param {string} looseDir
 * @returns {Promise<Map<string, () => Buffer | Promise<Buffer>>>}
 */
async function buildBodyLookup(zipPath, looseDir) {
	/** @type {Map<string, () => Buffer | Promise<Buffer>>} */
	const lookup = new Map();
	if (existsSync(zipPath)) {
		const dir = await extractZip(zipPath);
		for (const file of dir.files) {
			if (file.type !== 'File') continue;
			lookup.set(file.path, async () => Buffer.from(await file.buffer()));
		}
	}
	if (existsSync(looseDir)) {
		for (const rel of readDirRecursive(looseDir, looseDir)) {
			const abs = path.join(looseDir, rel);
			lookup.set(rel, () => readFileSync(abs));
		}
	}
	return lookup;
}

/**
 * Walks a directory and yields all file paths relative to `base` using
 * forward slashes (matching zip central directory naming).
 * @param {string} dir
 * @param {string} base
 * @returns {string[]}
 */
function readDirRecursive(dir, base) {
	/** @type {string[]} */
	const out = [];
	for (const entry of readdirSync(dir)) {
		const abs = path.join(dir, entry);
		const stat = statSync(abs);
		if (stat.isDirectory()) {
			out.push(...readDirRecursive(abs, base));
		} else {
			out.push(path.relative(base, abs).split(path.sep).join('/'));
		}
	}
	return out;
}

/**
 * Reduces a legacy `pages.html` value to the basename used as the lookup
 * key. Pre-#84 `Archive.write()` zipped the `snapshot-html/` directory's
 * contents directly, so zip entries are bare basenames (`123.html`), not
 * the prefixed paths (`snapshot-html/123.html`) the database column stored.
 * @param {string} stored
 * @returns {string}
 */
function normaliseRelPath(stored) {
	return path.basename(stored.split(path.sep).join('/'));
}

try {
	await main();
} catch (error) {
	console.error(error);
	process.exit(1);
}
