import type { ViewerReadModelBuildPhase } from '@nitpicker/query';

import { VIEWER_READ_MODEL_PHASE_LABELS } from './viewer-read-model-phase-labels.js';

/**
 * Formats a `buildViewerReadModel` phase-change notification for display on
 * the single `Lanes` line it's shown on (issue #294) — without this, the
 * many multi-minute steps between the one step with real N/M progress
 * (`viewer_pages`) are indistinguishable from a hang.
 *
 * Ends with `%dots%`, the same `Lanes`/`Display` animation placeholder
 * `crawler.ts` uses for its own no-progress-number phases (`'Scraping%dots%'`,
 * `'HEAD request%dots%'`, etc.) — `riffle()` animates it in `Lanes`'
 * non-verbose (single overwriting line) mode, and strips it to nothing in
 * `--verbose` mode. Without it, a phase with no sub-progress (most of them —
 * only `buildingPages`/`creatingIndexes`/`buildingAnchorFacts` report
 * N/M) renders as fully static text for however long that phase actually
 * takes, indistinguishable from `Lanes`' redraw loop itself having stalled.
 * @param phase - The phase that just started.
 * @returns A one-line, human-readable phase message ending in `%dots%`.
 * @example
 * ```ts
 * formatViewerReadModelPhase('buildingAnchorFacts'); // "Building anchor facts%dots%"
 * ```
 */
export function formatViewerReadModelPhase(phase: ViewerReadModelBuildPhase): string {
	return `${VIEWER_READ_MODEL_PHASE_LABELS[phase]}%dots%`;
}
