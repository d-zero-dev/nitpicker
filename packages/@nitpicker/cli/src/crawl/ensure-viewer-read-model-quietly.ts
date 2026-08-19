import type { Archive } from '@nitpicker/crawler';

import { buildViewerReadModelInWorker } from '@nitpicker/query';

/**
 * Builds the persistent viewer read model against a just-finished crawl's
 * archive, immediately before `CrawlerOrchestrator.write()` tars it —
 * issue #112's crawl-completion build trigger, wired at the CLI layer
 * (not inside `@nitpicker/crawler`) because the read-model builder lives in
 * `@nitpicker/query`, which already depends on `@nitpicker/crawler`; the
 * crawler package must not depend back on query.
 *
 * `--silent`-only now (issue #294): the non-silent `crawl` path renders the
 * build as individual `TaskList` rows via `run-post-crawl-task-list.ts`'s
 * `appendViewerReadModelPhaseRows` call instead of going through this
 * function, so this function no longer takes an `onProgress` callback — it
 * has no display to report to under `--silent`.
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
 * each long statement — see `buildViewerReadModelInWorker`'s docs. Under
 * `--silent` there is no display to freeze, but the worker offload still
 * keeps the SIGINT handler responsive.
 *
 * Never throws: `/api/pages` already falls back to the legacy `listPages`
 * path when the read model is missing or stale, so a build failure here
 * must not prevent the archive itself from being written. Under `--silent`
 * there is nowhere to report a failure to, so it is swallowed outright — the
 * non-silent path's own failure reporting lives in
 * `appendViewerReadModelPhaseRows`'s `onFailure` instead.
 * @param archive - The writable `Archive` instance about to be written to disk.
 */
export async function ensureViewerReadModelQuietly(archive: Archive): Promise<void> {
	try {
		// The crawler's write path inserts directly into `content_items` /
		// `page_meta` / … during the crawl, so the worker's build can read
		// them immediately without a legacy→entity populate step.
		await buildViewerReadModelInWorker(archive, {});
	} catch {
		// Swallowed — see this function's docs for why.
	}
}
