import { setImmediate as nextTurn } from 'node:timers/promises';

/**
 * Gives the event loop one turn so that the native memory of SQL statements
 * that already finished is freed before the next statement runs.
 *
 * The libsql binding (`libsql-dialect.ts` runs Knex on it) keeps each
 * statement's compiled program and bound values, and a `SELECT`'s row cursor
 * with its in-memory sort / `GROUP BY` tree, until the JavaScript wrapper
 * object is finalized. Node runs those N-API finalizers from a `setImmediate`,
 * not inside garbage collection itself, so a loop that only ever awaits
 * synchronous libsql calls (every Knex call on this driver resolves through
 * promise microtasks, never through the macrotask queue) can collect the
 * wrappers and still release nothing: the finalizers wait for a turn of the
 * loop that the loop never gets. Measured on the viewer read model build
 * (one transaction, one statement per 500-row chunk): the native side grew by
 * hundreds of MiB per bulk-insert phase and only shrank at `COMMIT`; forcing
 * garbage collection after every chunk did not change that, one turn of the
 * event loop after every chunk did. `scripts/bench-read-model-build.mjs`
 * reproduces both sides of that with `--gc` and `--regions` (see
 * `scripts/README.md`).
 *
 * The rule for callers: a loop that runs statements awaits this once per
 * iteration, after the iteration's statements. An iteration may run more
 * than one statement (a chunk's `INSERT` and the upsert derived from it); the
 * turn at its end releases all of them, and a statement that runs once
 * outside any loop is released by the next loop's turn.
 *
 * Why not reuse one prepared statement per table instead: the row cursors of
 * chunked `SELECT`s hold their sort trees the same way, and every bulk path
 * goes through Knex, which prepares a new statement per call. One turn per
 * iteration covers both, costs microseconds, and changes no SQL.
 *
 * Why not in `libsql-dialect.ts` for every query: a transaction that yields
 * between statements is fine for the archive (one connection, no
 * interleaving), but every caller would pay the turn, including per-request
 * viewer queries that run one statement and hold nothing worth a turn.
 * @example
 * for (const chunk of chunks) {
 *   await trx('viewer_pages').insert(chunk);
 *   await releaseFinishedStatements();
 * }
 */
export async function releaseFinishedStatements(): Promise<void> {
	await nextTurn();
}
