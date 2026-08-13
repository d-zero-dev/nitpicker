import type { Archive } from '@nitpicker/crawler';

import { scanJsResourcesForTechnologySignals } from '@nitpicker/crawler';

/**
 * Runs the post-crawl JS license-comment enrichment pass ("Flow 2" —
 * network I/O against already-discovered resources, distinct from
 * crawl-time signal extraction and from read-model backfill) against a
 * just-finished crawl's archive, immediately before
 * `ensureViewerReadModelQuietly` — so any newly-discovered technology
 * signal is reflected in the same run's `viewer_technology_summary` /
 * `viewer_technology_directory_stats` rather than requiring a second
 * `viewer-build`.
 *
 * Never throws: a flaky JS CDN or DNS hiccup during this best-effort pass
 * must not prevent the archive itself from being written, mirroring
 * `ensureViewerReadModelQuietly`'s own contract. Failures and a one-line
 * summary are reported to stderr.
 * @param archive - The writable `Archive` instance about to be written to disk.
 */
export async function scanJsResourcesQuietly(archive: Archive): Promise<void> {
	try {
		const result = await scanJsResourcesForTechnologySignals(archive);
		if (result.candidateCount > 0) {
			// eslint-disable-next-line no-console
			console.error(
				`[nitpicker] JS resource technology scan: ${result.matchedCount} match(es) across ${result.candidateCount} resource(s), ${result.pagesUpdatedCount} page(s) updated`,
			);
		}
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error(
			`[nitpicker] JS resource technology scan failed, continuing without it: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}
