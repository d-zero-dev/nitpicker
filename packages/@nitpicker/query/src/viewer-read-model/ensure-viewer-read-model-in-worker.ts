import type { BuildViewerReadModelOptions } from '../types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { getViewerReadModelVersion } from './get-viewer-read-model-version.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model-schema-version.js';
import { buildViewerReadModelInWorker } from './worker/build-viewer-read-model-in-worker.js';

/**
 * The worker-thread twin of {@link ensureViewerReadModel}: builds the viewer
 * read model in a worker thread if it is missing or stale (schema version
 * mismatch), otherwise does nothing.
 *
 * The staleness gate itself (a single `viewer_read_model_meta` row read)
 * runs on the calling thread against the already-open accessor — spawning a
 * worker just to discover there is nothing to do would cost more than the
 * query it guards. Only when a build is actually needed does the heavy,
 * event-loop-blocking work move off-thread via
 * {@link buildViewerReadModelInWorker} (issue #294).
 *
 * Mirrors {@link ensureViewerReadModel}'s read-only tolerance: a read-only
 * caller polling an already-current archive returns without ever inspecting
 * `accessor.readOnly`.
 *
 * Returns whether a build actually ran — `viewer-build` uses this to decide
 * whether its three unconditional backfills still need their own worker pass
 * (`runViewerReadModelBackfillsInWorker`): a build includes those backfills
 * internally, so re-running them after one would double multi-minute work
 * and refill the WAL the build's checkpoint just folded back (issue #294).
 * @param accessor - The archive accessor. Must be writable
 *   (`accessor.readOnly === false`) whenever a build actually turns out to
 *   be necessary.
 * @param options - Forwarded to {@link buildViewerReadModelInWorker} when a
 *   build is actually needed; ignored on the already-current no-op path.
 * @returns `true` when a build ran, `false` on the already-current no-op
 *   path.
 * @throws {Error} When a build is needed and `accessor.readOnly` is `true`.
 * @example
 * // viewer-build's default (non---force) path:
 * const built = await ensureViewerReadModelInWorker(archive, { onPhase, onProgress });
 * if (!built) {
 *   await runViewerReadModelBackfillsInWorker(archive, { onPhase, onProgress });
 * }
 */
export async function ensureViewerReadModelInWorker(
	accessor: ArchiveAccessor,
	options: BuildViewerReadModelOptions = {},
): Promise<boolean> {
	const version = await getViewerReadModelVersion(accessor);
	if (version === VIEWER_READ_MODEL_SCHEMA_VERSION) {
		return false;
	}
	await buildViewerReadModelInWorker(accessor, options);
	return true;
}
