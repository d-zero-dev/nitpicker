import type { Knex } from 'knex';

/**
 * The connection settings for one long bulk write, applied in this order and
 * put back in the reverse order. Each changes no output, only how much
 * memory SQLite keeps during the write:
 *
 * - `mmap_size = 0`: the pages of the archive file the kernel maps in count
 *   toward the process RSS, up to the whole 256 MiB window while the build
 *   scans the write model. Plain reads use the page cache instead.
 * - `cache_size = -16384` (16 MiB, from 64): the cache bounds both the dirty
 *   pages held before they spill to the WAL and the sorter's in-memory part,
 *   which SQLite sizes from `cache_size`.
 *
 * Why not `temp_store = FILE` too: libsql's SQLite is compiled with
 * `TEMP_STORE=2`, so `CREATE INDEX` sorts and the temporary trees behind
 * `ORDER BY` / `GROUP BY` stay in memory, and moving them to files lowers
 * the build's peak RSS further. But the files go to the OS temp directory,
 * not next to the archive: a small `/tmp` would stop a build that completes
 * today with `SQLITE_FULL`, and a `tmpfs` `/tmp` keeps them in RAM where the
 * RSS does not show them. Pointing them next to the archive needs
 * `PRAGMA temp_store_directory`, which SQLite deprecates and which is
 * process-wide and unsafe while another thread uses SQLite.
 */
const BULK_WRITE_SETTINGS: readonly (readonly [name: string, value: string])[] = [
	['mmap_size', '0'],
	['cache_size', '-16384'],
];

/**
 * Runs `work` with the connection tuned for one long bulk write (the viewer
 * read model build: one transaction that writes every `viewer_*` table and
 * then its indexes), then puts back the values those settings had on entry.
 * See {@link BULK_WRITE_SETTINGS} for what is changed and why. No other
 * setting is touched: `foreign_keys`, `wal_autocheckpoint` and anything the
 * caller set stay as they were.
 *
 * Together with the per-statement turns of `releaseFinishedStatements`, on a
 * multi-GB archive with a few thousand pages, these settings take the build's
 * peak RSS above an idle process to about half of what the read-tuned
 * settings give, with the build time in the same range. The measurement is
 * reproducible with `scripts/bench-read-model-build.mjs --regions` (see
 * `scripts/README.md`). The read-tuned 64 MiB cache and 256 MiB window
 * (`applyConnectionPragmas`) stay for reads because larger values were
 * measured to regress the viewer's queries; smaller ones are not re-measured
 * for reads here, so they are applied only for the duration of the bulk write.
 *
 * What the caller must know:
 *
 * - PRAGMAs are per connection, and the archive's Knex pool holds a single
 *   connection, so "the connection" is the one every query of `knex` runs on.
 *   A pool of several connections would tune only the one that happened to
 *   run the `PRAGMA` statements.
 * - It rejects a transaction object: `mmap_size` only changes between
 *   transactions, so inside one the setting would be accepted and silently
 *   not applied.
 * - The values are put back whether `work` resolved, threw, or the entry
 *   settings themselves failed partway (then every setting whose entry value
 *   was read is put back, the one that failed to change included). If `work` throws and putting them back throws too, both are
 *   reported in one `AggregateError`, so the bulk write's own failure (for
 *   example `SQLITE_FULL`) is not replaced. If `work` resolved and putting
 *   them back throws, the call still resolves with `work`'s result and the
 *   failure is reported with `process.emitWarning`: the bulk write is
 *   committed, and the settings only affect the speed of later reads on this
 *   connection, so failing the call would report a finished write as failed.
 * @param knex - The archive connection the bulk write runs on, outside any
 *   transaction.
 * @param work - The bulk write.
 * @returns What `work` resolved to.
 * @throws {Error} When `knex` is a transaction, or when `work` throws.
 * @example
 * const knex = accessor.getKnex();
 * await withBulkWritePragmas(knex, async () => {
 *   await knex.transaction(async (trx) => {
 *     // ... bulk inserts, then CREATE INDEX ...
 *   });
 * });
 */
export async function withBulkWritePragmas<T>(
	knex: Knex,
	work: () => Promise<T>,
): Promise<T> {
	if (knex.isTransaction === true) {
		throw new Error(
			'withBulkWritePragmas must be called outside a transaction: mmap_size only changes between transactions',
		);
	}
	const valuesOnEntry: [name: string, value: string][] = [];
	let result: T;
	try {
		for (const [name, value] of BULK_WRITE_SETTINGS) {
			valuesOnEntry.push([name, await readPragmaValue(knex, name)]);
			await knex.raw(`PRAGMA ${name} = ${value}`);
		}
		result = await work();
	} catch (workError) {
		try {
			await putBack(knex, valuesOnEntry);
		} catch (restoreError) {
			throw new AggregateError(
				[workError, restoreError],
				'The bulk write failed AND putting the connection settings back afterwards also failed.',
			);
		}
		throw workError;
	}
	try {
		await putBack(knex, valuesOnEntry);
	} catch (restoreError) {
		process.emitWarning(
			`The bulk write succeeded, but putting the connection settings back failed; later reads on this connection may be slower: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
			{ code: 'NITPICKER_BULK_WRITE_PRAGMAS_NOT_RESTORED' },
		);
	}
	return result;
}

/**
 * Reads one PRAGMA's current value as the text to set it back with.
 * @param knex - The connection.
 * @param name - The PRAGMA name.
 * @returns The value.
 * @throws {Error} When the driver returns no value for it.
 */
async function readPragmaValue(knex: Knex, name: string): Promise<string> {
	const rows: unknown = await knex.raw(`PRAGMA ${name}`);
	const value = Array.isArray(rows)
		? (rows[0] as Record<string, unknown> | undefined)?.[name]
		: undefined;
	if (typeof value !== 'number' && typeof value !== 'bigint') {
		throw new TypeError(`Could not read the current value of PRAGMA ${name}`);
	}
	return String(value);
}

/**
 * Sets each PRAGMA back to the value it had on entry, in the reverse order.
 * @param knex - The connection.
 * @param valuesOnEntry - The PRAGMAs changed so far, with their entry values.
 */
async function putBack(
	knex: Knex,
	valuesOnEntry: readonly (readonly [name: string, value: string])[],
): Promise<void> {
	for (const [name, value] of valuesOnEntry.toReversed()) {
		await knex.raw(`PRAGMA ${name} = ${value}`);
	}
}
