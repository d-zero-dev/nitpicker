import type {
	ViewerReadModelBuildPhase,
	ViewerReadModelBuildProgress,
} from '../../types.js';

/**
 * The `workerData` payload handed to the viewer-read-model worker thread at
 * construction time (issue #294). Passed via the `Worker` constructor rather
 * than a post-spawn `postMessage` handshake so there is no race between the
 * worker booting and the first message arriving — the worker can start the
 * build immediately at module evaluation.
 *
 * Only a directory path crosses the thread boundary: a live `ArchiveAccessor`
 * (and the `Knex` instance inside it) holds functions and native handles that
 * structured clone cannot transfer, so the worker reconnects to the same
 * SQLite database itself via `Archive.connect(tmpDir, null, { readOnly: false })`.
 */
export interface ViewerReadModelWorkerData {
	/**
	 * Absolute path to the archive's extracted working directory (the owning
	 * process's `Archive.open`/`Archive.create` tmpDir, which contains
	 * `db.sqlite` and, for failed-page diagnostics, `error.log`).
	 */
	tmpDir: string;
	/**
	 * Which job this one-shot worker performs: `'build'` runs
	 * `buildViewerReadModel` (which includes the three backfills and the
	 * final WAL checkpoint); `'backfills'` runs only the three backfills plus
	 * the checkpoint — `viewer-build`'s maintenance path for an archive whose
	 * read model is already current, where a full rebuild is skipped but the
	 * backfills must still catch the data up (see that command's docs).
	 * Either way the heavy synchronous SQL stays off the main thread
	 * (issue #294).
	 */
	task: 'build' | 'backfills';
}

/**
 * Every message the viewer-read-model worker posts back to the main thread
 * (issue #294). One worker performs exactly one build, so unlike
 * `@nitpicker/core`'s pool protocol there is no `taskId` correlation — the
 * stream is strictly `phase`/`progress` updates followed by a single terminal
 * `done` or `error`.
 *
 * `error` carries only the message string: an `Error` instance survives
 * structured clone, but the main-thread wrapper re-wraps it anyway to get a
 * stack trace pointing at the calling side, so the extra fidelity would be
 * unused (same trade-off as `@nitpicker/core`'s `result.error` field).
 */
export type ViewerReadModelWorkerMessage =
	| {
			/** A named build phase just started. */
			type: 'phase';
			/** The phase, forwarded verbatim from `buildViewerReadModel`'s `onPhase`. */
			phase: ViewerReadModelBuildPhase;
	  }
	| {
			/** Sub-progress within the current phase. */
			type: 'progress';
			/** The snapshot, forwarded verbatim from `buildViewerReadModel`'s `onProgress`. */
			progress: ViewerReadModelBuildProgress;
	  }
	| {
			/** The build completed and the worker's DB connection is already closed. */
			type: 'done';
	  }
	| {
			/** The build failed; the worker's DB connection is already closed. */
			type: 'error';
			/** The failure's `Error#message` (or stringified non-Error throw). */
			message: string;
	  };
