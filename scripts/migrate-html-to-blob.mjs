#!/usr/bin/env node
/**
 * One-shot migration: converts a pre-#75 `.nitpicker` archive (HTML stored
 * as `snapshot-html.zip` + `pages.html` path strings) to the post-#75 layout
 * (zstd-compressed BLOBs in `page_html_blobs` + `page_html_ref`).
 *
 * USAGE
 * -----
 *
 *     node scripts/migrate-html-to-blob.mjs <old.nitpicker> [<new.nitpicker>]
 *
 * If <new.nitpicker> is omitted, writes to "<old>.migrated.nitpicker" next
 * to the input. The original file is never modified or deleted.
 *
 * NOTES
 * -----
 *
 * - Single-shot: on any failure, the partial output is removed and the
 *   work dir is cleaned up. Re-run from scratch — there is no resume.
 * - Progress: prints `read N/M` and `insert N/M` lines every 500 rows
 *   plus a start marker so multi-hour runs don't look hung.
 * - Streaming: rows are read in chunks, hashed + compressed + inserted in
 *   small per-chunk transactions, then released. Designed to run with
 *   bounded memory against 100k-page / 7+ GB archives.
 * - The `pages.html` column is dropped from the migrated database. New
 *   tables `page_html_blobs(hash, body, codec, size_raw, size_stored)` and
 *   `page_html_ref(page_id, hash)` are created (both WITHOUT ROWID,
 *   matching `init-schema.ts`).
 * - Idempotency: re-running on an archive where data has already been
 *   migrated (page_html_ref non-empty) fails fast. Re-running on an
 *   archive where only the runtime schema-migration has added empty
 *   tables (no ref rows) is allowed — that is the expected state when a
 *   user opened the legacy archive before running this script.
 * - v0.x: no read-side compatibility with the legacy zip layout, hence
 *   this script.
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
import { zstdCompressSync } from 'node:zlib';

import { extractZip } from '@d-zero/fs/zip';
import libsqlPkg from 'libsql';
import * as tar from 'tar';

const Database = libsqlPkg.default ?? libsqlPkg;

const SQLITE_DB_FILE_NAME = 'db.sqlite';
const SNAPSHOT_HTML_DIR = 'snapshot-html';
/**
 * Chunk size for the streaming migration loop. Sized to keep three
 * pressures balanced:
 *
 * - **Memory**: one chunk's HTML bodies are buffered in RAM
 *   simultaneously (~500 × ~75 KB ≈ 35 MB for a typical site crawl). A
 *   larger chunk risks OOMs on the 7+ GB archives the script was
 *   written for.
 * - **WAL bound**: each chunk commits in its own SQLite transaction +
 *   PASSIVE checkpoint, so the WAL stays well under 100 MB even for
 *   100k-row migrations. A much smaller chunk would multiply transaction
 *   overhead.
 * - **Progress visibility**: a chunk completes every few seconds on a
 *   modern laptop, giving the operator a steady stream of feedback.
 *
 * Bump it if the host has lots of memory and the archive's typical body
 * size is small.
 */
const CHUNK_SIZE = 500;

/**
 * Entry point. Parses argv and runs the migration end-to-end.
 */
async function main() {
	const [inputArg, outputArg] = process.argv.slice(2);
	if (!inputArg) {
		console.error(
			'Usage: node scripts/migrate-html-to-blob.mjs <old.nitpicker> [<new.nitpicker>]',
		);
		process.exit(1);
	}
	const inputPath = path.resolve(inputArg);
	const outputPath = path.resolve(
		outputArg ??
			path.join(
				path.dirname(inputPath),
				`${path.basename(inputPath, path.extname(inputPath))}.migrated.nitpicker`,
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
		const inputBase = path.basename(inputPath, path.extname(inputPath));
		const outputBase = path.basename(outputPath, path.extname(outputPath));
		console.log(`[1/3] untar ${inputPath} -> ${workDir}`);
		await tar.x({ file: inputPath, cwd: workDir });

		const extractedDir = path.join(workDir, inputBase);
		if (!existsSync(extractedDir)) {
			// v0 convention: a `.nitpicker` is a tar whose single top-level
			// member is a directory whose name matches the archive basename.
			// If the directory is missing, the input was probably produced
			// by a non-Nitpicker tool, or has already been migrated by a
			// previous script run.
			throw new Error(
				`Untar did not produce expected directory: ${extractedDir} ` +
					`(input archive layout does not match the v0 .nitpicker convention; ` +
					`is this an already-migrated or non-Nitpicker tar?)`,
			);
		}
		const dbPath = path.join(extractedDir, SQLITE_DB_FILE_NAME);
		const zipPath = path.join(extractedDir, `${SNAPSHOT_HTML_DIR}.zip`);
		const looseDir = path.join(extractedDir, SNAPSHOT_HTML_DIR);
		if (!existsSync(dbPath)) {
			throw new Error(`Missing ${SQLITE_DB_FILE_NAME} in input archive`);
		}

		console.log('[2/3] rewrite db.sqlite (stream blob inserts, drop pages.html)');
		await rewriteDatabase(dbPath, zipPath, looseDir);

		// Remove the legacy layout artifacts so the re-tarred archive is
		// clean (no snapshot-html/, no snapshot-html.zip).
		if (existsSync(zipPath)) rmSync(zipPath, { force: true });
		if (existsSync(looseDir)) rmSync(looseDir, { recursive: true, force: true });
		// libsql leaves -wal / -shm sidecars after close even after a
		// TRUNCATE checkpoint. They are zero-byte / mostly-empty but tar
		// would still include them; remove for a clean output archive.
		for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
			if (existsSync(sidecar)) rmSync(sidecar, { force: true });
		}

		// Rename the inner directory to match the OUTPUT archive's basename:
		// `Archive.open(filePath)` looks for `path.basename(filePath, ext)` inside
		// the tar to determine which dir to untar / rename. Without this the
		// migrated `.nitpicker` is unreadable by the post-#75 CLI even though
		// its DB is correct.
		if (inputBase !== outputBase) {
			const { renameSync } = await import('node:fs');
			renameSync(extractedDir, path.join(workDir, outputBase));
		}

		console.log(`[3/3] tar -> ${outputPath}`);
		await tar.c({ file: outputPath, cwd: workDir, portable: true }, [outputBase]);

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
 * Creates the new tables (if missing), iterates the legacy `pages.html`
 * column in chunks, resolves each row's body from the snapshot zip / loose
 * dir, hashes + compresses + inserts it into `page_html_blobs` +
 * `page_html_ref`, and finally drops the legacy `pages.html` column. Each
 * chunk runs in its own transaction so an interrupted run does not hold a
 * multi-hour write lock and the WAL stays bounded.
 * @param {string} dbPath - Path to the legacy `db.sqlite` inside the work dir.
 * @param {string} zipPath - Path to the legacy `snapshot-html.zip`.
 * @param {string} looseDir - Path to the legacy `snapshot-html/`.
 */
async function rewriteDatabase(dbPath, zipPath, looseDir) {
	const db = new Database(dbPath);
	try {
		db.exec('PRAGMA journal_mode = WAL');
		db.exec('PRAGMA foreign_keys = ON');

		ensureBlobTables(db);

		// Idempotency guard: the runtime schema-migration creates the
		// tables but never adds rows. If `page_html_ref` already has
		// rows the archive was previously data-migrated — refuse rather
		// than silently double-running.
		const refRows = db.prepare('SELECT COUNT(*) AS n FROM page_html_ref').get();
		if (refRows && Number(refRows.n) > 0) {
			throw new Error(
				`page_html_ref already contains ${refRows.n} rows — archive looks already migrated. ` +
					'Re-extract the original .nitpicker and re-run if you need to retry.',
			);
		}

		const hasHtmlColumn = columnExists(db, 'pages', 'html');
		if (!hasHtmlColumn) {
			console.log('  pages.html column already gone — nothing to migrate');
			return;
		}

		const lookup = await buildBodyLookup(zipPath, looseDir);

		const totalRow = db
			.prepare("SELECT COUNT(*) AS n FROM pages WHERE html IS NOT NULL AND html != ''")
			.get();
		const total = Number(totalRow?.n ?? 0);
		console.log(`  ${total} rows to migrate`);

		const selectChunk = db.prepare(
			"SELECT id, html FROM pages WHERE html IS NOT NULL AND html != '' AND id > ? ORDER BY id LIMIT ?",
		);
		const insertBlob = db.prepare(
			'INSERT INTO page_html_blobs(hash, body, codec, size_raw, size_stored) ' +
				'VALUES (?, ?, ?, ?, ?) ON CONFLICT(hash) DO NOTHING',
		);
		const insertRef = db.prepare(
			'INSERT INTO page_html_ref(page_id, hash) VALUES (?, ?)',
		);

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
						`  [skip] page id=${row.id}: body "${rel}" not found in zip or loose dir`,
					);
					continue;
				}
				resolved.push({ id: row.id, body: await resolver() });
			}
			db.transaction(() => {
				for (const { id, body } of resolved) {
					const hash = createHash('sha256').update(body).digest();
					const compressed = zstdCompressSync(body);
					insertBlob.run(
						hash,
						compressed,
						'zstd',
						body.byteLength,
						compressed.byteLength,
					);
					insertRef.run(id, hash);
				}
			})();
			processed += rows.length;
			lastId = rows.at(-1).id;
			console.log(`  [${processed}/${total}] processed`);
			// Keep the WAL bounded across the run.
			db.exec('PRAGMA wal_checkpoint(PASSIVE)');
		}

		db.exec('ALTER TABLE pages DROP COLUMN html');
		db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
	} finally {
		db.close();
	}
}

/**
 * Creates the new BLOB tables and index if not already present. Mirrors
 * the runtime `migrateHtmlBlobTables` helper so the script can finalise
 * the schema for legacy archives that have not yet been opened by the
 * new CLI.
 * @param {InstanceType<typeof Database>} db - Open libsql handle.
 */
function ensureBlobTables(db) {
	const hasBlobs = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='page_html_blobs'",
		)
		.get();
	if (hasBlobs) {
		return;
	}
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
 * Builds the relative-path → body-resolver lookup that spans the loose
 * `snapshot-html/` directory and the `snapshot-html.zip` central
 * directory. The loose dir wins on collision (an interrupted
 * `Archive.write()` could have updated the dir but not yet rewritten the
 * zip). Resolvers are lazy so this function returns quickly even on
 * archives with hundreds of thousands of entries.
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
 * Reduces a legacy `pages.html` value to the basename used as the
 * lookup key. Pre-#75 `Archive.write()` zipped the `snapshot-html/`
 * directory's contents directly, so zip entries are bare basenames
 * (`123.html`), not the prefixed paths (`snapshot-html/123.html`) the
 * database column stores. Strip the prefix and any OS-specific
 * separators so legacy archives written on either platform resolve.
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
