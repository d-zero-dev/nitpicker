import type { ViewerReadModelBuildPhase } from '@nitpicker/query';

/**
 * Ordered phase sequence `runViewerReadModelBackfillsInWorker` announces via
 * `onPhase` — a strict, unconditional subsequence of
 * `VIEWER_READ_MODEL_FULL_BUILD_PHASES` (see
 * `viewer-read-model-worker-entry.ts`'s `'backfills'` branch). Notably omits
 * `backfillingAnalysisViolations`, which only runs as part of a full rebuild.
 * `viewer-build` selects this array instead of the full one when the
 * schema-version gate reports the read model is already current (issue #294).
 */
export const VIEWER_READ_MODEL_BACKFILL_PHASES: readonly ViewerReadModelBuildPhase[] = [
	'backfillingBodyHash',
	'backfillingAliasOfId',
	'backfillingDedupeCapEventId',
	'checkpointing',
];
