import type { ViewerReadModelBuildPhase } from '@nitpicker/query';

import { VIEWER_READ_MODEL_PHASE_LABELS } from './viewer-read-model-phase-labels.js';

/**
 * Formats a `buildViewerReadModel` phase-change notification for display as
 * a `TaskList` row's `ctx.progress()` message (issue #294) — without this,
 * the many multi-minute phases between the one phase with real N/M progress
 * (`viewer_pages`) are indistinguishable from a hang. Both callers
 * (`ensure-viewer-read-model-quietly.ts`'s post-crawl row and `viewer-build`'s
 * own row) run this as a single task-list row's message, so no animation
 * placeholder is embedded here — the row's own `[%taskSpin%]` state icon
 * already animates while it's `running`.
 * @param phase - The phase that just started.
 * @returns A one-line, human-readable phase message.
 * @example
 * ```ts
 * formatViewerReadModelPhase('buildingAnchorFacts');
 * // "Building anchor facts"
 * ```
 */
export function formatViewerReadModelPhase(phase: ViewerReadModelBuildPhase): string {
	return VIEWER_READ_MODEL_PHASE_LABELS[phase];
}
