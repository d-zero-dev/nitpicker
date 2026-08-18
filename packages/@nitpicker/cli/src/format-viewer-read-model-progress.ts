import type {
	ViewerReadModelBuildPhase,
	ViewerReadModelBuildProgress,
} from '@nitpicker/query';

import { formatProgressCount } from './format-progress-count.js';
import { VIEWER_READ_MODEL_PHASE_LABELS } from './viewer-read-model-phase-labels.js';

/**
 * Progress unit noun for phases whose `onProgress` reports something other
 * than `viewer_pages` rows (issue #294) — e.g. `creatingIndexes` counts
 * indexes created, `buildingAnchorFacts` counts `content_items.id` ranges
 * scanned. Phases absent here (including `buildingPages`, the original
 * `onProgress` use case) default to `"pages"` in
 * {@link formatViewerReadModelProgress}.
 */
const PROGRESS_UNIT_BY_PHASE: Partial<Record<ViewerReadModelBuildPhase, string>> = {
	creatingIndexes: 'indexes',
	buildingAnchorFacts: 'id ranges',
};

/**
 * Formats a `buildViewerReadModel`/`ensureViewerReadModel` progress update
 * for the single `Lanes` line it's displayed on — shared by the
 * crawl-completion hook (`ensure-viewer-read-model-quietly.ts`) and the
 * explicit `viewer-build` command so the two call sites can't drift into
 * inconsistent wording.
 *
 * `onProgress` reports `{ insertedRows, totalRows }` regardless of which
 * phase is running (issue #294 extended it beyond its original
 * `viewer_pages`-only scope to `creatingIndexes` and `buildingAnchorFacts`
 * too — the field names stayed put to avoid a breaking type change, but the
 * meaning is "units done / units total for whichever phase is current").
 * Passing that phase here picks the matching label and unit noun instead of
 * always claiming to build "viewer read model" pages; omit it (or pass
 * `buildingPages`) for the original meaning.
 *
 * No timestamp here: a `Lanes` line overwrites itself, so a timestamp would
 * just flicker uselessly instead of aiding correlation. Callers that need to
 * correlate this against timestamped `DEBUG=Nitpicker:*` output (issue #294)
 * prefix it themselves when displaying in `Lanes`' `verbose` (appended-line)
 * mode.
 * @param progress - The current sub-progress for whichever phase is running.
 * @param phase - The phase this progress belongs to (from the most recent
 *   `onPhase` call). Omit for the original `viewer_pages`-only wording.
 * @returns A one-line, human-readable progress message.
 */
export function formatViewerReadModelProgress(
	progress: ViewerReadModelBuildProgress,
	phase?: ViewerReadModelBuildPhase,
): string {
	const label =
		phase && phase !== 'buildingPages'
			? VIEWER_READ_MODEL_PHASE_LABELS[phase]
			: 'Building viewer read model';
	const unit = (phase && PROGRESS_UNIT_BY_PHASE[phase]) || 'pages';
	return `${label}: ${formatProgressCount(progress.insertedRows, progress.totalRows, unit)}`;
}
