import type { Archive } from '@nitpicker/crawler';

import { scanJsResourcesForTechnologySignals } from '@nitpicker/crawler';

import { dedupeProgressMessage } from '../dedupe-progress-message.js';
import { formatProgressCount } from '../format-progress-count.js';

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
 * Wires `scanJsResourcesForTechnologySignals`'s `onProgress` into `onProgress`
 * (issue #294): re-fetching hundreds to thousands of already-discovered JS
 * resources over the network can take a while, and without this the pass
 * looked completely silent between the crawl's own progress display ending
 * and this function's one-line completion summary. The caller owns display
 * (a post-crawl task-list row's `ctx.progress`, or nothing under `--silent`)
 * — this function only formats the count, never a label or animation marker,
 * since the caller's own row already carries both.
 *
 * Never throws: a flaky JS CDN or DNS hiccup during this best-effort pass
 * must not prevent the archive itself from being written, mirroring
 * `ensureViewerReadModelQuietly`'s own contract. Both the completion summary
 * (match/resource/page counts) and a failure are reported through
 * `onProgress` when it's provided — never *also* through `console.error`
 * (issue #294 code review: this function runs while the caller's own
 * `'Scan JS resources'` `TaskList` row is still active, and a bare
 * `console.error` there corrupts dealer's cursor tracking the same way the
 * self-healing migration notices did). `onProgress` is only omitted under
 * `--silent`, which has no display to corrupt — `console.error` is the
 * fallback for that path only, so the operator still sees the outcome.
 * @param archive - The writable `Archive` instance about to be written to disk.
 * @param onProgress - Called with the rendered count fragment (e.g.
 *   `"3/10 resources (30%)"`) whenever it changes. Omit for no reporting.
 */
export async function scanJsResourcesQuietly(
	archive: Archive,
	onProgress?: (message: string) => void,
): Promise<void> {
	const reportProgress = dedupeProgressMessage((message) => {
		onProgress?.(message);
	});
	try {
		const result = await scanJsResourcesForTechnologySignals(archive, {
			onProgress: (processed, total) => {
				reportProgress(formatProgressCount(processed, total, 'resources'));
			},
		});
		if (result.candidateCount > 0) {
			const message = `${result.matchedCount} match(es) across ${result.candidateCount} resource(s), ${result.pagesUpdatedCount} page(s) updated`;
			if (onProgress) {
				onProgress(message);
			} else {
				// eslint-disable-next-line no-console -- --silent has no TaskList row to report through
				console.error(`[nitpicker] JS resource technology scan: ${message}`);
			}
		}
	} catch (error) {
		const message = `Scan JS resources failed, continuing without it: ${
			error instanceof Error ? error.message : String(error)
		}`;
		if (onProgress) {
			onProgress(message);
		} else {
			// eslint-disable-next-line no-console -- --silent has no TaskList row to report through
			console.error(`[nitpicker] ${message}`);
		}
	}
}
