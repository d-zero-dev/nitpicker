import type { BuildViewerReadModelOptions } from '../../types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { runViewerReadModelWorkerTask } from './run-viewer-read-model-worker-task.js';

/**
 * Runs {@link buildViewerReadModel} inside a one-shot worker thread instead
 * of the calling thread (issue #294).
 *
 * The knex/libsql driver executes every SQL statement synchronously on the
 * calling thread, so an in-thread build blocks the event loop for the
 * duration of each statement — on a 400k-page archive a single
 * `CREATE INDEX` or summary `GROUP BY` runs for minutes, freezing the CLI's
 * `Lanes` progress display and starving the SIGINT handler (Ctrl-C appears
 * dead). Offloading the whole build keeps the main thread responsive the
 * entire time; `onPhase`/`onProgress` arrive via worker messages exactly as
 * if the build ran locally.
 *
 * The worker opens its own writable connection to `accessor.tmpDir` (see the
 * worker entry's module docs for why that second connection is safe here),
 * so this function must be called with the same writable accessor
 * `buildViewerReadModel` itself would require — the guard is enforced
 * eagerly, before any thread is spawned. While the worker runs, the caller
 * must not issue queries through `accessor` (both CLI call sites simply
 * `await` this function, so their main-thread connection sits idle).
 *
 * Rejects — never resolves silently — on all three failure routes (see
 * {@link runViewerReadModelWorkerTask}). Callers keep their existing
 * semantics: `ensureViewerReadModelQuietly` swallows the rejection,
 * `viewer-build` restores its `.bak`.
 * @param accessor - The writable accessor whose `tmpDir` the worker rebuilds
 *   against. Must satisfy the same writability requirement as
 *   {@link buildViewerReadModel}.
 * @param options - `onPhase`/`onProgress` callbacks, invoked on the calling
 *   thread as worker messages arrive.
 * @throws {Error} When `accessor.readOnly` is `true`, or when the worker
 *   build fails.
 * @example
 * // Same call shape as buildViewerReadModel, minus the frozen event loop:
 * await buildViewerReadModelInWorker(archive, {
 *   onPhase: (phase) => console.error(phase),
 * });
 */
export async function buildViewerReadModelInWorker(
	accessor: ArchiveAccessor,
	options: BuildViewerReadModelOptions = {},
): Promise<void> {
	await runViewerReadModelWorkerTask(accessor, 'build', options);
}
