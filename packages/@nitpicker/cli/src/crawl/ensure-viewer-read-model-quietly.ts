import type { Archive } from '@nitpicker/crawler';

import { buildViewerReadModelInWorker } from '@nitpicker/query';

import { formatViewerReadModelPhase } from '../format-viewer-read-model-phase.js';
import { formatViewerReadModelProgress } from '../format-viewer-read-model-progress.js';

/**
 * Builds the persistent viewer read model against a just-finished crawl's
 * archive, immediately before `CrawlerOrchestrator.write()` tars it —
 * issue #112's crawl-completion build trigger, wired at the CLI layer
 * (not inside `@nitpicker/crawler`) because the read-model builder lives in
 * `@nitpicker/query`, which already depends on `@nitpicker/crawler`; the
 * crawler package must not depend back on query.
 *
 * Calls `buildViewerReadModelInWorker` unconditionally — NOT the
 * schema-version-gated `ensureViewerReadModelInWorker` — so the read model
 * is rebuilt on every crawl-completion path, including `--append` /
 * `--retry-failed` / `--inventory` re-crawls of an archive whose read model
 * was already built once at the current schema. The schema-version gate only
 * detects a schema change, never a data change, so it would silently skip
 * the rebuild on exactly those re-crawls and leave newly-written pages
 * unreflected in the viewer (Computed Readonly Table category in
 * ARCHITECTURE.md — always safe to discard and rebuild wholesale). This
 * repeats the same fixed-cost full-table rebuild on every completion
 * regardless of how much data actually changed; cheaper "did anything
 * change" tracking is a follow-up, not a correctness requirement.
 *
 * The build runs in a worker thread (issue #294): the knex/libsql driver
 * executes SQL synchronously on the calling thread, so an in-thread build
 * would freeze the caller's display and SIGINT handler for the duration of
 * each long statement — see `buildViewerReadModelInWorker`'s docs. The main
 * thread only relays the worker's phase/progress messages to `onProgress`.
 *
 * Never throws: `/api/pages` already falls back to the legacy `listPages`
 * path when the read model is missing or stale, so a build failure here
 * must not prevent the archive itself from being written. The caller owns
 * display (a post-crawl task-list row's `ctx.progress`, or nothing under
 * `--silent`) — this function only reports through `onProgress`, including
 * on failure, since large archives (issue #112: 400k pages take minutes)
 * must not look hung. Also wires `onPhase` (issue #294): a few phases have
 * no countable unit (see `ViewerReadModelBuildPhase`'s docs), so without
 * `onPhase` those stretches would report nothing between the build starting
 * and completing. Tracks the most-recently-started phase in `currentPhase`
 * so an `onProgress` update is labeled with the right phase and unit (e.g.
 * `Creating indexes: 23/59 indexes`, not a bare, unlabeled `23/59`).
 * @param archive - The writable `Archive` instance about to be written to disk.
 * @param onProgress - Called with a human-readable phase/progress message
 *   whenever it changes, and once more with a failure summary if the build
 *   throws. Omit for no reporting.
 */
export async function ensureViewerReadModelQuietly(
	archive: Archive,
	onProgress?: (message: string) => void,
): Promise<void> {
	let currentPhase: Parameters<typeof formatViewerReadModelPhase>[0] | undefined;
	try {
		// The crawler's write path inserts directly into `content_items` /
		// `page_meta` / … during the crawl, so the worker's build can read
		// them immediately without a legacy→entity populate step.
		await buildViewerReadModelInWorker(archive, {
			onPhase: (phase) => {
				currentPhase = phase;
				onProgress?.(formatViewerReadModelPhase(phase));
			},
			onProgress: (progress) => {
				onProgress?.(formatViewerReadModelProgress(progress, currentPhase));
			},
		});
	} catch (error) {
		onProgress?.(
			`Viewer read model build failed, writing the archive without it: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}
