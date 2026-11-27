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
 * Matches the statements that end the outermost transaction successfully:
 * `COMMIT`, and `END`, which SQLite treats as the same statement. Knex sends
 * `COMMIT` after the callback of `transaction()` resolves.
 */
const OUTERMOST_COMMIT_PATTERN = /^(?:COMMIT|END)\b/i;

/**
 * Matches every statement that ends a transaction successfully: the outermost
 * `COMMIT` / `END`, and `RELEASE SAVEPOINT` for a nested transaction.
 */
const COMMIT_PATTERN = /^(?:COMMIT|END|RELEASE(?:\s+SAVEPOINT)?)\b/i;

/**
 * Matches the statement Knex sends to start the outermost transaction. A new
 * transaction on a connection drops what {@link rolledBackBy} holds for it.
 */
const BEGIN_PATTERN = /^BEGIN\b/i;

/**
 * Matches the rollback of the outermost transaction: `ROLLBACK` without
 * `TO`. `ROLLBACK TO <savepoint>` rolls a nested transaction back and leaves
 * the outer one open.
 */
const OUTERMOST_ROLLBACK_PATTERN = /^ROLLBACK\b(?!\s+TO\b)/i;

/**
 * The error that made SQLite roll a transaction back by itself, per
 * connection. Set when a statement of a Knex transaction fails and leaves the
 * connection outside any transaction; read when a later `COMMIT` / `END` /
 * `RELEASE SAVEPOINT` fails while it is set; dropped when the outermost
 * transaction ends (`COMMIT`, `END` or `ROLLBACK`, whether it was executed,
 * skipped or replaced) or the next one begins (`BEGIN`). The error holds the
 * SQL with its bound values, so it is not kept longer than that. A `WeakMap`
 * so a closed connection takes its entry along.
 */
const rolledBackBy = new WeakMap<object, unknown>();

/**
 * Builds the error that replaces the `COMMIT` / `RELEASE SAVEPOINT` failure
 * after an automatic rollback. Carries the original error as `cause` and
 * copies its `code`: a caller that did not catch the error gets the original
 * error, one that did catches this one, and both can read the same `code`.
 * The message names only the code: Knex appends the whole SQL, bound values
 * included, to the original message, and repeating it here would repeat the
 * stored data.
 * @param cause - The error that made SQLite roll the transaction back
 */
function rolledBackCommitError(cause: unknown): Error {
	const code = (cause as { code?: unknown } | null | undefined)?.code;
	const error = new Error(
		`SQLite rolled the transaction back by itself after an earlier error${typeof code === 'string' ? ` (${code})` : ''}. ` +
			'Statements before that error were rolled back; statements after it may have run outside the transaction.',
		{ cause },
	);
	if (typeof code === 'string') {
		Object.assign(error, { code });
	}
	return error;
}

/**
 * Knex dialect that reuses the `better-sqlite3` adapter logic but swaps the
 * underlying driver for `libsql`. `libsql` ships pre-compiled binaries via the
 * `@libsql/<platform>-<arch>` optionalDependencies pattern, so no postinstall
 * download from GitHub Releases is required.
 *
 * A transaction that SQLite rolls back by itself (for example on a full disk)
 * rejects with the original error, not with the failure of the `ROLLBACK`
 * Knex sends afterwards.
 *
 * When the caller catches that error inside the callback and carries on, the
 * transaction is already gone and what Knex sends at the end fails:
 * `COMMIT` with `cannot commit - no transaction is active`, and
 * `RELEASE SAVEPOINT` of a nested transaction with `no such savepoint`. That
 * failure is replaced by an error that says SQLite rolled the transaction
 * back, with the original error as `cause` and its `code`. It is not turned
 * into a success: what the transaction wrote before the error was rolled
 * back, and the caller has to know.
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
 *
 * try {
 *   await db.transaction(async (trx) => {
 *     try {
 *       await trx.raw('INSERT INTO t (v) VALUES (?)', ['...']);
 *     } catch {
 *       // Carrying on after the error does not keep the transaction alive.
 *     }
 *   });
 * } catch (error) {
 *   // `code` is `SQLITE_FULL` again, and the original error is in `cause`.
 *   console.error((error as { code?: string }).code, (error as { cause?: unknown }).cause);
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
	 * Skips a `ROLLBACK` for a transaction SQLite has already rolled back,
	 * replaces the failure of a later `COMMIT` / `END` / `RELEASE SAVEPOINT`
	 * with an error that names the cause, and delegates every statement to the
	 * `better-sqlite3` implementation otherwise. Knex calls it from outside the
	 * client (`executeQuery`), so it must stay reachable at runtime; `protected`
	 * is only a compile-time marker, as for `_driver`.
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
	 * `COMMIT` and `RELEASE SAVEPOINT` are executed, not skipped: reporting
	 * them as done would show data that was never written as saved. The
	 * statement that left the connection outside its transaction is remembered
	 * per connection, and when a later `COMMIT` / `RELEASE SAVEPOINT` fails,
	 * its error is replaced by one that says SQLite rolled the transaction
	 * back, with the remembered error as `cause`. The memory is kept through
	 * the nested rollbacks and releases in between, even when a nested
	 * transaction opens a new transaction of its own with `SAVEPOINT`, because
	 * the outer transaction may still commit after them. It is dropped when
	 * the outermost transaction ends (`COMMIT`, `END` or `ROLLBACK`, whether
	 * executed, skipped or replaced) or the next one begins (`BEGIN`).
	 * Statements that succeed after the rollback ran outside any transaction
	 * and are written. If a nested transaction opened a new transaction of its
	 * own and the outer `COMMIT` then succeeds, nothing is reported: that
	 * `COMMIT` is a real one.
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
		const sql = query.sql ?? '';
		const rollback = ROLLBACK_PATTERN.exec(sql);
		const transacting = this.transacting === true;
		const tracked = typeof connection === 'object' && connection !== null;
		// Only a statement that ends the outermost transaction: a nested one leaves it open.
		const endsOutermost =
			OUTERMOST_COMMIT_PATTERN.test(sql) || OUTERMOST_ROLLBACK_PATTERN.test(sql);
		if (transacting && inTransaction === false && rollback) {
			dbLog('Skipping %s: SQLite has already rolled the transaction back', rollback[1]);
			if (tracked && endsOutermost) {
				rolledBackBy.delete(connection);
			}
			query.response = { changes: 0, lastInsertRowid: 0 };
			query.context = { lastID: 0, changes: 0 };
			return query;
		}
		if (tracked && BEGIN_PATTERN.test(sql)) {
			// A new transaction: whatever rolled back an earlier one no longer applies.
			rolledBackBy.delete(connection);
		}
		try {
			const result = await super._query(connection, query);
			if (tracked && endsOutermost) {
				rolledBackBy.delete(connection);
			}
			return result;
		} catch (error) {
			if (transacting && tracked) {
				// Only a statement that found no transaction to end is the one the memory explains;
				// one that fails inside a live transaction (a deferred foreign key, say) keeps its error.
				if (
					inTransaction === false &&
					COMMIT_PATTERN.test(sql) &&
					rolledBackBy.has(connection)
				) {
					const cause = rolledBackBy.get(connection);
					if (endsOutermost) {
						rolledBackBy.delete(connection);
					}
					dbLog('Replacing the failure of %s: SQLite rolled the transaction back', sql);
					throw rolledBackCommitError(cause);
				}
				const inTransactionAfter = (connection as { inTransaction?: boolean })
					.inTransaction;
				// A failing statement that ends the outermost transaction needs no memory:
				// nothing commits after it. The first cause is kept: it is the one that
				// discarded the writes of the outer transaction.
				if (
					inTransaction === true &&
					inTransactionAfter === false &&
					!endsOutermost &&
					!rolledBackBy.has(connection)
				) {
					rolledBackBy.set(connection, error);
				}
			}
			throw error;
		}
	}
}
