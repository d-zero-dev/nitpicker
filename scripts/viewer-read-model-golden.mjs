/**
 * Golden check of the viewer read model on a real archive, for corpora that
 * cannot be committed (dogfooding crawls).
 *
 *   node scripts/viewer-read-model-golden.mjs dump <archive> <out.jsonl>
 *   node scripts/viewer-read-model-golden.mjs check <archive> <golden.jsonl>
 *
 * Both modes run `buildViewerReadModel` on a throwaway copy of the archive and
 * read back every `viewer_*` table (found through `sqlite_master`, so a table
 * added later is covered without a change here), in the order the table is
 * defined to keep its rows: rowid order for a rowid table (insertion order is
 * part of the output: it is what `ORDER BY` less reads see), primary-key order
 * for a `WITHOUT ROWID` table. `viewer_read_model_meta.built_at` is left out
 * because it differs on every build.
 *
 * A table is stored as its row count plus a SHA-256 per 10,000 rows (see
 * `golden-lib/digest-row-chunks.mjs`), one JSON line per entry
 * (`[table, key, value]`): the largest tables hold millions of rows, and the
 * rows contain crawled URLs, which the dump should not.
 *
 * Take the dump from a build of the base branch (before the change under
 * test), and keep it **outside the repository**. `check` exits 1 on any
 * difference, printing for each differing table the counts and the first few
 * differing keys (`chunk:<first row index>` names the row range, no row
 * content is printed), and exits 2 when the comparison could not run at all.
 *
 * The source archive is never modified. Needs `yarn build` first.
 */

/* eslint-disable import-x/no-extraneous-dependencies */

import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import { buildViewerReadModel } from '@nitpicker/query';

import { withWritableArchiveCopy } from './bench-lib/with-writable-archive-copy.mjs';
import { buildKeysetQuery } from './golden-lib/build-keyset-query.mjs';
import { digestRowChunks } from './golden-lib/digest-row-chunks.mjs';
import { isWithoutRowid } from './golden-lib/is-without-rowid.mjs';
import { listRecordDifferences } from './golden-lib/list-record-differences.mjs';
import { normalizeReadModelRow } from './golden-lib/normalize-read-model-row.mjs';
import { quoteIdentifier } from './golden-lib/quote-identifier.mjs';

/** Rows hashed together into one digest. */
const DIGEST_CHUNK_ROWS = 10_000;

/** Rows read from SQLite per query. */
const READ_CHUNK_ROWS = 5000;

/** Differing keys printed per table by `check`. */
const SHOWN_DIFFERENCES = 5;

const [mode, archivePath, goldenPath] = process.argv.slice(2);
if ((mode !== 'dump' && mode !== 'check') || !archivePath || !goldenPath) {
	process.stderr.write(
		'Usage: node scripts/viewer-read-model-golden.mjs <dump|check> <archive> <golden.jsonl>\n',
	);
	process.exit(2);
}

/**
 * Walks a table in its defined order, one keyset chunk at a time.
 * @param {import('knex').Knex} knex - The archive's connection.
 * @param {string} table - A `viewer_*` table.
 * @param {string[] | undefined} keyColumns - Primary-key columns of a
 *   `WITHOUT ROWID` table, or `undefined` for a rowid table.
 * @yields {Record<string, unknown>} Normalized rows.
 */
async function* readTable(knex, table, keyColumns) {
	let afterKey;
	for (;;) {
		const { sql, bindings } = buildKeysetQuery({
			table,
			keyColumns,
			chunkSize: READ_CHUNK_ROWS,
			afterKey,
		});
		const rows = await knex.raw(sql, bindings);
		if (rows.length === 0) {
			return;
		}
		const last = rows.at(-1);
		afterKey = keyColumns ? keyColumns.map((name) => last[name]) : [last.__rowid];
		for (const row of rows) {
			yield normalizeReadModelRow(table, row);
		}
	}
}

/**
 * @param {import('knex').Knex} knex - The archive's connection.
 * @returns {Promise<{ name: string, keyColumns: string[] | undefined }[]>} Every
 *   `viewer_*` table, by name, with its primary-key columns when it is `WITHOUT ROWID`.
 */
async function listTables(knex) {
	const tables = await knex.raw(
		`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name LIKE 'viewer\\_%' ESCAPE '\\' ORDER BY name`,
	);
	const result = [];
	for (const { name, sql } of tables) {
		if (!isWithoutRowid(sql)) {
			result.push({ name, keyColumns: undefined });
			continue;
		}
		const columns = await knex.raw(`PRAGMA table_info(${quoteIdentifier(name)})`);
		const keyColumns = columns
			.filter((column) => column.pk > 0)
			.toSorted((a, b) => a.pk - b.pk)
			.map((column) => column.name);
		result.push({ name, keyColumns });
	}
	return result;
}

/**
 * Builds the read model on a throwaway copy of the archive and summarizes
 * every table.
 * @param {string} source - The `.nitpicker` file.
 * @returns {Promise<Map<string, Map<string, string>>>} Table → entries.
 */
function collect(source) {
	return withWritableArchiveCopy(source, async (archive) => {
		await buildViewerReadModel(archive);
		const knex = archive.getKnex();
		const categories = new Map();
		for (const { name, keyColumns } of await listTables(knex)) {
			categories.set(
				name,
				await digestRowChunks(readTable(knex, name, keyColumns), DIGEST_CHUNK_ROWS),
			);
		}
		return categories;
	});
}

/**
 * Writes the dump to a sibling `.partial` file and renames it into place once
 * it is fully flushed, so a failure part-way (a full disk, a bad path) never
 * leaves a truncated golden that a later `check` would read as complete.
 * @param {string} file - Where to write.
 * @param {Map<string, Map<string, string>>} categories - What to write.
 * @returns {Promise<void>} Resolves when the file is in place.
 */
async function writeDump(file, categories) {
	const partial = `${file}.partial`;
	try {
		const out = createWriteStream(partial);
		// An 'error' (EISDIR, ENOSPC, ...) rejects `once(out, 'finish')` and each
		// `once(out, 'drain')`; this handler keeps the first one from being an
		// unhandled event while the loop is between awaits.
		out.on('error', () => {});
		for (const [category, entries] of categories) {
			for (const [key, value] of entries) {
				if (!out.write(`${JSON.stringify([category, key, value])}\n`)) {
					await once(out, 'drain');
				}
			}
		}
		out.end();
		await once(out, 'finish');
		await rename(partial, file);
	} catch (error) {
		await rm(partial, { force: true });
		throw error;
	}
}

/**
 * @param {string} file - A dump.
 * @returns {Promise<Map<string, Map<string, string>>>} Table → entries.
 */
async function readDump(file) {
	const categories = new Map();
	const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
	for await (const line of lines) {
		const [category, key, value] = JSON.parse(line);
		if (
			typeof category !== 'string' ||
			typeof key !== 'string' ||
			typeof value !== 'string'
		) {
			throw new TypeError(
				'Not a viewer-read-model golden dump: every line must be [table, key, value]',
			);
		}
		if (!categories.has(category)) {
			categories.set(category, new Map());
		}
		categories.get(category).set(key, value);
	}
	return categories;
}

/**
 * @param {string} label - Table name for the report.
 * @param {Map<string, string>} expected - Golden entries.
 * @param {Map<string, string>} actual - Fresh entries.
 * @returns {number} How many keys differ (missing, extra or changed).
 */
function reportTable(label, expected, actual) {
	const differing = listRecordDifferences(
		Object.fromEntries(expected),
		Object.fromEntries(actual),
	);
	if (differing.length === 0) {
		return 0;
	}
	process.stdout.write(
		`${label}: rows ${expected.get('rows') ?? '(missing)'} expected, ${actual.get('rows') ?? '(missing)'} actual, ${differing.length} differing\n`,
	);
	for (const key of differing.slice(0, SHOWN_DIFFERENCES)) {
		process.stdout.write(`  ${key}\n`);
	}
	return differing.length;
}

/**
 * Runs the requested mode.
 * @returns {Promise<number>} The exit code: 0 when `dump` succeeds or `check`
 *   finds no difference, 1 when `check` finds differences.
 */
async function run() {
	if (mode === 'dump') {
		const categories = await collect(archivePath);
		await writeDump(goldenPath, categories);
		process.stdout.write(
			`wrote ${[...categories].map(([name, entries]) => `${name}=${entries.get('rows')}`).join(' ')}\n`,
		);
		return 0;
	}
	const golden = await readDump(goldenPath);
	const result = await collect(archivePath);
	let differing = 0;
	for (const name of new Set([...golden.keys(), ...result.keys()])) {
		differing += reportTable(
			name,
			golden.get(name) ?? new Map(),
			result.get(name) ?? new Map(),
		);
	}
	process.stdout.write(
		differing === 0
			? `${result.size} tables match the golden\n`
			: `${differing} entries differ\n`,
	);
	return differing === 0 ? 0 : 1;
}

// Exit 1 means "the output differs"; anything that kept the comparison
// from happening exits 2 like a usage error, so a caller never mistakes a
// crash for a difference.
try {
	process.exitCode = await run();
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
	process.exitCode = 2;
}
