import type { Archive } from '@nitpicker/crawler';

import { buildViewerReadModel } from '@nitpicker/query';

import { formatViewerReadModelProgress } from '../format-viewer-read-model-progress.js';

/**
 * Builds the persistent viewer read model against a just-finished crawl's
 * archive, immediately before `CrawlerOrchestrator.write()` tars it —
 * issue #112's crawl-completion build trigger, wired at the CLI layer
 * (not inside `@nitpicker/crawler`) because the read-model builder lives in
 * `@nitpicker/query`, which already depends on `@nitpicker/crawler`; the
 * crawler package must not depend back on query.
 *
 * Calls `buildViewerReadModel` directly — NOT the schema-version-gated
 * `ensureViewerReadModel` — so the read model is unconditionally rebuilt
 * on every crawl-completion path, including `--append` / `--retry-failed`
 * / `--inventory` re-crawls of an archive whose read model was already
 * built once at the current schema. `ensureViewerReadModel`'s gate only
 * detects a schema change, never a data change, so it would silently skip
 * the rebuild on exactly those re-crawls and leave newly-written pages
 * unreflected in the viewer (Computed Readonly Table category in
 * ARCHITECTURE.md — always safe to discard and rebuild wholesale). This
 * repeats the same fixed-cost full-table rebuild on every completion
 * regardless of how much data actually changed; cheaper "did anything
 * change" tracking is a follow-up, not a correctness requirement.
 *
 * Never throws: `/api/pages` already falls back to the legacy `listPages`
 * path when the read model is missing or stale, so a build failure here
 * must not prevent the archive itself from being written. Progress and
 * failures are both reported to stderr — large archives (issue #112: 400k
 * pages take minutes) must not look hung, and a silent failure would leave
 * an operator wondering why the viewer is slow with no error to investigate.
 * @param archive - The writable `Archive` instance about to be written to disk.
 */
export async function ensureViewerReadModelQuietly(archive: Archive): Promise<void> {
	try {
		// The crawler's write path inserts directly into `content_items` /
		// `page_meta` / … during the crawl, so `buildViewerReadModel` can
		// read them immediately without a legacy→entity populate step.
		await buildViewerReadModel(archive, {
			onProgress: (progress) => {
				// eslint-disable-next-line no-console
				console.error(formatViewerReadModelProgress(progress));
			},
		});
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error(
			`[nitpicker] viewer read model build failed, writing the archive without it: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}
