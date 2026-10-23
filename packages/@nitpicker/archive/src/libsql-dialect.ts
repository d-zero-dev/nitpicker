import type { Knex } from 'knex';

// @ts-expect-error - Internal Knex subpath without published type declarations
import Client_BetterSQLite3 from 'knex/lib/dialects/better-sqlite3/index.js';
import libsql from 'libsql';

import { dbLog } from './debug.js';

/**
 * Minimal shape of the query object Knex passes to `_query`.
 * `response` / `context` are what the `better-sqlite3` dialect fills in for
 * statements that return no rows.
 */
interface DialectQuery {
	sql?: string;
	response?: unknown;
	context?: unknown;
}

/**
 * Type of Knex's internal `better-sqlite3` dialect: `Knex.Client` plus the two
 * members {@link LibsqlDialect} relies on that the published declaration lacks.
 * Declared as a class (not a constructor type) so the static side of
 * `Knex.Client` is kept and `knex({ client: LibsqlDialect })` still type-checks.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ambient class, only ever used as a type
declare class BetterSqlite3Client extends Knex.Client {
	/**
	 * `true` only on the per-transaction client Knex derives from the main one
	 * (`makeTxClient`), through which every query of a transaction runs.
	 */
	transacting?: boolean;
	protected _query(connection: unknown, query: DialectQuery): Promise<DialectQuery>;
}

/**
 * Untyped reference to Knex's internal `better-sqlite3` dialect.
 *
 * Knex's published `exports` do not include this subpath, so TypeScript cannot
 * resolve a declaration file for it. The dialect is a concrete subclass of
 * `Knex.Client` at runtime, so the safe cast is intentional.
 */
const Base = Client_BetterSQLite3 as unknown as typeof BetterSqlite3Client;

/**
 * Matches `ROLLBACK` and `ROLLBACK TO SAVEPOINT`. Capture group 1 is the
 * statement kind, for logging.
 *
 * Same prefix test Knex's `Transaction#query` (`lib/execution/transaction.js`)
 * uses to recognise a rollback statement. Keep the two in step when upgrading
 * Knex.
 */
const ROLLBACK_PATTERN = /^(ROLLBACK(?:\s+TO\s+SAVEPOINT)?)\b/i;

/**
 * Knex dialect that reuses the `better-sqlite3` adapter logic but swaps the
 * underlying driver for `libsql`. `libsql` ships pre-compiled binaries via the
 * `@libsql/<platform>-<arch>` optionalDependencies pattern, so no postinstall
 * download from GitHub Releases is required.
 *
 * A transaction that SQLite rolls back by itself (for example on a full disk)
 * rejects with the original error, not with the failure of the `ROLLBACK`
 * Knex sends afterwards.
 * @example
 * ```ts
 * import knex from 'knex';
 *
 * import { LibsqlDialect } from './libsql-dialect.js';
 *
 * const db = knex({
 *   client: LibsqlDialect,
 *   connection: { filename: 'archive.sqlite' },
 *   useNullAsDefault: true,
 * });
 *
 * try {
 *   await db.transaction(async (trx) => {
 *     await trx.raw('INSERT INTO t (v) VALUES (?)', ['...']);
 *   });
 * } catch (error) {
 *   // `SQLITE_FULL` when the disk filled up mid-transaction,
 *   // not `ROLLBACK - cannot rollback - no transaction is active`.
 *   console.error((error as { code?: string }).code);
 * }
 * ```
 */
export class LibsqlDialect extends Base {
	/**
	 * Returns the `libsql` constructor as the SQLite driver.
	 *
	 * Typed as `unknown` to avoid leaking the `Libsql.DatabaseConstructor`
	 * namespace from a non-re-exported module across the public API surface.
	 */
	protected _driver(): unknown {
		return libsql;
	}

	/**
	 * Skips a `ROLLBACK` for a transaction SQLite has already rolled back, and
	 * delegates every other statement to the `better-sqlite3` implementation.
	 * Knex calls it from outside the client (`executeQuery`), so it must stay
	 * reachable at runtime; `protected` is only a compile-time marker, as for
	 * `_driver`.
	 *
	 * Why: SQLite rolls a transaction back by itself on some errors
	 * (`SQLITE_FULL`, `SQLITE_IOERR`, `SQLITE_INTERRUPT`, `SQLITE_NOMEM` in the
	 * documented list, which SQLite reserves the right to extend) and documents
	 * that a following `ROLLBACK` then fails harmlessly
	 * (https://www.sqlite.org/lang_transaction.html, "Response To Errors Within
	 * A Transaction"). Knex does not treat it as harmless:
	 * `Transaction#query` replaces the error being rolled back with the failure
	 * of the `ROLLBACK`, so callers would see `ROLLBACK - cannot rollback - no
	 * transaction is active` instead of the `SQLITE_FULL` that caused it.
	 *
	 * Why not in each caller: every transaction in the archive goes through
	 * this dialect, and all of them lose the original error the same way.
	 *
	 * The skip needs all of: a Knex transaction client (`transacting`), a
	 * connection that reports `inTransaction === false`, and a rollback
	 * statement. Anything else is executed, so a stray `ROLLBACK` through the
	 * main client, or on a connection that does not expose the flag, stays
	 * visible as the programming error it is.
	 *
	 * `ROLLBACK TO SAVEPOINT` is skipped under the same conditions: the
	 * automatic rollback discards the savepoints with the transaction. A caller
	 * that catches the error of a nested transaction and carries on with the
	 * outer one is then running in autocommit mode, because the outer
	 * transaction no longer exists.
	 *
	 * The result mirrors what the `better-sqlite3` dialect records for a
	 * statement that returns no rows. Nothing ran, so there is no row id or
	 * change count to report, and `0` is fine even when `safeIntegers` makes
	 * real results `bigint`.
	 * @param connection - The raw `libsql` connection.
	 * @param query - The Knex query object.
	 */
	protected override async _query(
		connection: unknown,
		query: DialectQuery,
	): Promise<DialectQuery> {
		// `connection` may be undefined: `super._query` then reports `No connection provided`.
		const inTransaction = (connection as { inTransaction?: boolean } | undefined)
			?.inTransaction;
		const rollback = ROLLBACK_PATTERN.exec(query.sql ?? '');
		if (this.transacting === true && inTransaction === false && rollback) {
			dbLog('Skipping %s: SQLite has already rolled the transaction back', rollback[1]);
			query.response = { changes: 0, lastInsertRowid: 0 };
			query.context = { lastID: 0, changes: 0 };
			return query;
		}
		return super._query(connection, query);
	}
}
