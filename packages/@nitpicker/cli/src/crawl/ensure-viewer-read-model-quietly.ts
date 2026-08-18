import type { Archive } from '@nitpicker/crawler';

import { Lanes } from '@d-zero/dealer';
import { buildViewerReadModelInWorker } from '@nitpicker/query';

import { formatLogLine } from '../format-log-line.js';
import { formatViewerReadModelPhase } from '../format-viewer-read-model-phase.js';
import { formatViewerReadModelProgress } from '../format-viewer-read-model-progress.js';

/** Options controlling {@link ensureViewerReadModelQuietly}'s progress display. */
export type EnsureViewerReadModelQuietlyOptions = {
	/**
	 * When `true`, progress lines are appended (one per update) instead of
	 * overwriting a single terminal line — same convention as the `analyze`
	 * command's `Lanes` usage. Pass the crawl command's own `--verbose` flag.
	 */
	verbose?: boolean;
};

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
 * freezes the `Lanes` line and the SIGINT handler for the duration of each
 * long statement — see `buildViewerReadModelInWorker`'s docs. The main
 * thread only relays the worker's phase/progress messages into the display.
 *
 * Never throws: `/api/pages` already falls back to the legacy `listPages`
 * path when the read model is missing or stale, so a build failure here
 * must not prevent the archive itself from being written. Progress and
 * failures are both reported to stderr via `Lanes` (same single-line,
 * overwriting display as the crawl's own progress — `--verbose` switches it
 * to one appended line per update) — large archives (issue #112: 400k pages
 * take minutes) must not look hung, and a silent failure would leave an
 * operator wondering why the viewer is slow with no error to investigate.
 * Also wires `onPhase` (issue #294): a few phases have no countable unit
 * (see `ViewerReadModelBuildPhase`'s docs), so without `onPhase` those
 * stretches would display nothing between "starting" and "completed".
 * Tracks the most-recently-started phase in `currentPhase` so an
 * `onProgress` update is labeled with the right phase and unit (e.g.
 * `Creating indexes: 23/59 indexes`, not a bare, unlabeled `23/59`).
 *
 * In `--verbose` mode, each appended line also carries an ISO 8601 timestamp
 * (issue #294): the crawl's own progress display and `DEBUG=Nitpicker:*`
 * output give no other signal that this phase has even started, so a build
 * that stalls without throwing (as opposed to failing loudly) would
 * otherwise be indistinguishable — the appended lines are the only record of
 * when this phase began and how far it got. The default single-line display
 * skips the timestamp: it would just flicker on every overwrite instead of
 * aiding correlation, since there's no history of prior lines to line it up
 * against.
 * @param archive - The writable `Archive` instance about to be written to disk.
 * @param options - See {@link EnsureViewerReadModelQuietlyOptions}.
 */
export async function ensureViewerReadModelQuietly(
	archive: Archive,
	options?: EnsureViewerReadModelQuietlyOptions,
): Promise<void> {
	using lanes = new Lanes({
		verbose: options?.verbose,
		indent: '  ',
		stream: process.stderr,
	});
	const laneId = 0;
	const update = (message: string) => {
		lanes.update(laneId, formatLogLine(!!options?.verbose, message));
	};
	update('Viewer read model build: starting');
	let currentPhase: Parameters<typeof formatViewerReadModelPhase>[0] | undefined;
	try {
		// The crawler's write path inserts directly into `content_items` /
		// `page_meta` / … during the crawl, so the worker's build can read
		// them immediately without a legacy→entity populate step.
		await buildViewerReadModelInWorker(archive, {
			onPhase: (phase) => {
				currentPhase = phase;
				update(formatViewerReadModelPhase(phase));
			},
			onProgress: (progress) => {
				update(formatViewerReadModelProgress(progress, currentPhase));
			},
		});
		update('Viewer read model build: completed');
	} catch (error) {
		update(
			`Viewer read model build failed, writing the archive without it: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}
