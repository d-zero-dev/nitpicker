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
	computingSummary: 'steps',
	loadingPageRows: 'ids',
	loadingTechnologyRows: 'ids',
	buildingDirectoryTree: 'rows',
	buildingTechnologySummary: 'rows',
	buildingIsolatedComponents: 'rows',
	buildingAnchorFacts: 'id ranges',
	buildingGraph: 'edge ids',
	buildingResources: 'resource ids',
	buildingImages: 'image ids',
	buildingHeaderChecks: 'rows',
	buildingDuplicateGroups: 'ids',
	buildingMismatches: 'scans',
	creatingIndexes: 'indexes',
};

/**
 * Formats a `buildViewerReadModel`/`ensureViewerReadModel` progress update
 * as a single display-agnostic message string — shared by the
 * crawl-completion hook (`ensure-viewer-read-model-quietly.ts`) and the
 * explicit `viewer-build` command (a `TaskList` row's `ctx.progress()`
 * message in both cases) so the two call sites can't drift into
 * inconsistent wording.
 *
 * `onProgress` reports `{ insertedRows, totalRows }` regardless of which
 * phase is running (the field names stay fixed across every phase — the
 * meaning is "units done / units total for whichever phase is current"; see
 * `ViewerReadModelBuildProgress`'s docs for the per-phase unit). Passing
 * that phase here picks the matching label and unit noun instead of always
 * claiming to build "viewer read model" pages; omit it (or pass
 * `buildingPages`) for the original meaning.
 *
 * No animation placeholder is embedded here: both call sites render this as
 * a `TaskList` row's message, and the row's own `[%taskSpin%]` state icon
 * already animates while it's `running` — same as `formatViewerReadModelPhase`.
 * @param progress - The current sub-progress for whichever phase is running.
 * @param phase - The phase this progress belongs to (from the most recent
 *   `onPhase` call). Omit for the original `viewer_pages`-only wording.
 * @returns A one-line, human-readable progress message.
 * @example
 * ```ts
 * formatViewerReadModelProgress({ insertedRows: 50, totalRows: 100 });
 * // "Building viewer read model: 50/100 pages (50%)"
 * formatViewerReadModelProgress({ insertedRows: 23, totalRows: 57 }, 'creatingIndexes');
 * // "Creating indexes: 23/57 indexes (40%)"
 * ```
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
