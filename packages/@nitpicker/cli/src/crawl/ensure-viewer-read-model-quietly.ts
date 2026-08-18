import type { Archive } from '@nitpicker/crawler';

import { Lanes } from '@d-zero/dealer';
import { buildViewerReadModel } from '@nitpicker/query';

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
 * failures are both reported to stderr via `Lanes` (same single-line,
 * overwriting display as the crawl's own progress — `--verbose` switches it
 * to one appended line per update) — large archives (issue #112: 400k pages
 * take minutes) must not look hung, and a silent failure would leave an
 * operator wondering why the viewer is slow with no error to investigate.
 * Also wires `onPhase` (issue #294): most steps have no `onProgress` of
 * their own (only `buildingPages`, `creatingIndexes`, and
 * `buildingAnchorFacts` report sub-progress), so without `onPhase` the
 * backfills, summary computation, and every other read-model table would
 * display nothing between "starting" and "completed". Tracks the
 * most-recently-started phase in `currentPhase` so an `onProgress` update is
 * labeled with the right phase and unit (e.g. `Creating indexes: 23/57
 * indexes`, not a bare, unlabeled `23/57`).
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
		lanes.update(
			laneId,
			options?.verbose ? `${new Date().toISOString()} ${message}` : message,
		);
	};
	update('Viewer read model build: starting');
	let currentPhase: Parameters<typeof formatViewerReadModelPhase>[0] | undefined;
	try {
		// The crawler's write path inserts directly into `content_items` /
		// `page_meta` / … during the crawl, so `buildViewerReadModel` can
		// read them immediately without a legacy→entity populate step.
		await buildViewerReadModel(archive, {
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
