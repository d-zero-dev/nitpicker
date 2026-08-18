/**
 * Worker thread entry point for the viewer read model build (issue #294).
 *
 * This module runs inside the one-shot `new Worker(...)` created by
 * `run-viewer-read-model-worker-task.ts` — never on the main thread. It
 * exists because the knex/libsql driver executes every SQL statement
 * synchronously on the calling thread (`libsql-dialect.ts` extends knex's
 * better-sqlite3 dialect over libsql's sync N-API bindings): a single big
 * `CREATE INDEX` or `GROUP BY` over a 400k-page archive blocks the event
 * loop for minutes, freezing the CLI's `Lanes` progress line and starving
 * the SIGINT handler so Ctrl-C appears dead. Running the whole job here
 * keeps the main thread's event loop free the entire time.
 *
 * ## Lifecycle
 *
 * 1. Receives `{ tmpDir, task }` via `workerData` (constructor payload — no
 *    post-spawn handshake, so no boot race).
 * 2. Opens its own writable connection with
 *    `Archive.connect(tmpDir, null, { readOnly: false })`. This is the
 *    archive-owning process reconnecting to a tmpDir it extracted itself
 *    (see that method's JSDoc) — the parent thread already holds the
 *    archive lock, and worker threads share the parent's PID, so the
 *    PID-based cross-process lock stays valid. The connection re-runs the
 *    self-healing migrations, which are all `IF NOT EXISTS`/`hasColumn`
 *    guarded no-ops on the already-migrated database.
 * 3. Runs the requested task (see `ViewerReadModelWorkerData.task`),
 *    relaying `onPhase`/`onProgress` to the parent as `postMessage` events.
 * 4. Closes its DB connection (always — the parent's `archive.write()`
 *    checkpoint must not race a dangling worker handle), posts `done` or
 *    `error`, and exits via `setImmediate(() => process.exit(0))` so the
 *    final message flushes first (same technique as
 *    `@nitpicker/core`'s worker entry).
 *
 * The message protocol is defined in `./types.ts`.
 * @module
 */

import type { ViewerReadModelWorkerData, ViewerReadModelWorkerMessage } from './types.js';

import { parentPort, workerData } from 'node:worker_threads';

import { Archive } from '@nitpicker/crawler';

import { backfillAliasOfId } from '../backfill-alias-of-id.js';
import { backfillBodyHashFromHtmlBlobs } from '../backfill-body-hash-from-html-blobs.js';
import { backfillDedupeCapEventId } from '../backfill-dedupe-cap-event-id.js';
import { buildViewerReadModel } from '../build-viewer-read-model.js';

if (!parentPort) {
	throw new Error('Use in worker thread');
}

const port = parentPort;
const { tmpDir, task } = workerData as ViewerReadModelWorkerData;

// The one job this worker exists for, run via top-level await.
//
// Never rethrows: every failure (connect, task, close) is reported to the
// parent as an `error` message so the main-thread wrapper can reject its
// Promise — an uncaught throw here would surface as a less descriptive
// `worker 'error'` event instead.
try {
	const accessor = await Archive.connect(tmpDir, null, { readOnly: false });
	try {
		if (task === 'backfills') {
			// viewer-build's maintenance path for an already-current read
			// model: the same three backfills `buildViewerReadModel` runs
			// internally, followed by the same WAL fold-back — see that
			// function's `checkpointing` phase for why the checkpoint must
			// happen here on the worker's own connection rather than on the
			// caller's later `archive.write()`.
			post({ type: 'phase', phase: 'backfillingBodyHash' });
			await backfillBodyHashFromHtmlBlobs(accessor, relayBackfillProgress);
			post({ type: 'phase', phase: 'backfillingAliasOfId' });
			await backfillAliasOfId(accessor, relayBackfillProgress);
			post({ type: 'phase', phase: 'backfillingDedupeCapEventId' });
			await backfillDedupeCapEventId(accessor, relayBackfillProgress);
			post({ type: 'phase', phase: 'checkpointing' });
			await accessor.getKnex().raw('PRAGMA wal_checkpoint(TRUNCATE)');
		} else {
			await buildViewerReadModel(accessor, {
				onPhase: (phase) => {
					post({ type: 'phase', phase });
				},
				onProgress: (progress) => {
					post({ type: 'progress', progress });
				},
			});
		}
	} catch (taskError) {
		// A plain `finally { await accessor.close() }` would let a close
		// failure mask the original task error. Surface both via
		// `AggregateError` (same pattern as `crawler-orchestrator.ts`'s
		// restore-on-failure paths) instead of losing the task error.
		try {
			await accessor.close();
		} catch (closeError) {
			throw new AggregateError(
				[taskError, closeError],
				'viewer read model task failed AND closing the worker archive connection also failed.',
			);
		}
		throw taskError;
	}
	await accessor.close();
	post({ type: 'done' });
} catch (error) {
	post({
		type: 'error',
		message: error instanceof Error ? error.message : String(error),
	});
}
// Defer the exit one macrotask so the terminal `done`/`error` postMessage
// above flushes to the parent before the thread tears down.
setImmediate(() => process.exit(0));

/**
 * Posts one protocol message to the parent thread.
 * @param message - The message to send.
 */
function post(message: ViewerReadModelWorkerMessage): void {
	port.postMessage(message);
}

/**
 * Adapts the backfills' `(processed, total)` callback shape to the worker's
 * progress protocol — the parent labels the counts with whichever backfill
 * phase most recently started.
 * @param processed - Units processed so far.
 * @param total - Total units to process.
 */
function relayBackfillProgress(processed: number, total: number): void {
	post({ type: 'progress', progress: { insertedRows: processed, totalRows: total } });
}
