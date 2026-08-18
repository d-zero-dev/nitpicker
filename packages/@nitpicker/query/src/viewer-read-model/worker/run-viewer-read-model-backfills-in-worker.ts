import type { BuildViewerReadModelOptions } from '../../types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { runViewerReadModelWorkerTask } from './run-viewer-read-model-worker-task.js';

/**
 * Runs `viewer-build`'s three unconditional backfills
 * (`backfillBodyHashFromHtmlBlobs` → `backfillAliasOfId` →
 * `backfillDedupeCapEventId`) plus the WAL checkpoint inside a one-shot
 * worker thread (issue #294).
 *
 * This is the maintenance path for an archive whose read model is already
 * current: the schema-version gate skips the full rebuild (which would have
 * run these same backfills internally — see `buildViewerReadModel`), but the
 * backfills must still catch the underlying data up. Running them on the
 * main thread would re-freeze the display twice over: the backfills' own
 * synchronous SQL, and then the WAL they write making the caller's
 * `archive.write()` checkpoint a multi-minute synchronous PRAGMA. The worker
 * absorbs both, ending with the same `wal_checkpoint(TRUNCATE)` fold-back
 * the build task performs.
 *
 * Progress arrives through the same `onPhase`/`onProgress` channel as the
 * build task, using the three `backfilling*` phases and `checkpointing`.
 * @param accessor - The writable accessor whose `tmpDir` the worker
 *   reconnects to.
 * @param options - `onPhase`/`onProgress` callbacks, invoked on the calling
 *   thread as worker messages arrive.
 * @throws {Error} When `accessor.readOnly` is `true`, or when the worker
 *   task fails.
 * @example
 * // viewer-build, when ensureViewerReadModelInWorker reports "already current":
 * await runViewerReadModelBackfillsInWorker(archive, { onPhase, onProgress });
 */
export async function runViewerReadModelBackfillsInWorker(
	accessor: ArchiveAccessor,
	options: BuildViewerReadModelOptions = {},
): Promise<void> {
	await runViewerReadModelWorkerTask(accessor, 'backfills', options);
}
