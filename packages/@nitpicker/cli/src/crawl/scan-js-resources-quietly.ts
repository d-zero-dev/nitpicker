import type { Archive } from '@nitpicker/crawler';

import { Lanes } from '@d-zero/dealer';
import { scanJsResourcesForTechnologySignals } from '@nitpicker/crawler';

import { createCountProgressLogger } from '../create-count-progress-logger.js';
import { formatLogLine } from '../format-log-line.js';

/** Options controlling {@link scanJsResourcesQuietly}'s progress display. */
export interface ScanJsResourcesQuietlyOptions {
	/**
	 * When `true`, progress lines are appended (one per update) instead of
	 * overwriting a single terminal line — same convention as
	 * `ensureViewerReadModelQuietly`. Pass the crawl command's own
	 * `--verbose` flag.
	 */
	verbose?: boolean;
}

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
 * Wires `scanJsResourcesForTechnologySignals`'s `onProgress` into a `Lanes`
 * line (issue #294): re-fetching hundreds to thousands of already-discovered
 * JS resources over the network can take a while, and without this the pass
 * looked completely silent between the crawl's own progress display ending
 * and this function's one-line completion summary.
 *
 * Never throws: a flaky JS CDN or DNS hiccup during this best-effort pass
 * must not prevent the archive itself from being written, mirroring
 * `ensureViewerReadModelQuietly`'s own contract. Failures and a one-line
 * summary are reported to stderr.
 * @param archive - The writable `Archive` instance about to be written to disk.
 * @param options - See {@link ScanJsResourcesQuietlyOptions}.
 */
export async function scanJsResourcesQuietly(
	archive: Archive,
	options?: ScanJsResourcesQuietlyOptions,
): Promise<void> {
	using lanes = new Lanes({
		verbose: options?.verbose,
		indent: '  ',
		stream: process.stderr,
	});
	const log = (message: string) => {
		lanes.update(0, formatLogLine(!!options?.verbose, message));
	};
	try {
		const progressLogger = createCountProgressLogger(
			log,
			'Scanning JS resources',
			'resources',
		);
		const result = await scanJsResourcesForTechnologySignals(archive, {
			onProgress: progressLogger,
		});
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
