import type { Archive } from '@nitpicker/crawler';

import { ensureViewerReadModel } from '@nitpicker/query';

import { formatViewerReadModelProgress } from '../format-viewer-read-model-progress.js';

/**
 * Builds the persistent viewer read model against a just-finished crawl's
 * archive, immediately before `CrawlerOrchestrator.write()` tars it —
 * issue #112's crawl-completion build trigger, wired at the CLI layer
 * (not inside `@nitpicker/crawler`) because `ensureViewerReadModel` lives in
 * `@nitpicker/query`, which already depends on `@nitpicker/crawler`; the
 * crawler package must not depend back on query.
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
		await ensureViewerReadModel(archive, {
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
