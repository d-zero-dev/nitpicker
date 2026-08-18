import type { ViewerReadModelBuildPhase } from '@nitpicker/query';

import { VIEWER_READ_MODEL_PHASE_LABELS } from './viewer-read-model-phase-labels.js';

/**
 * Formats a `buildViewerReadModel` phase-change notification for display on
 * the single `Lanes` line it's shown on (issue #294) — without this, the
 * many multi-minute steps between the one step with real N/M progress
 * (`viewer_pages`) are indistinguishable from a hang.
 *
 * Starts with the `%braille%` spinner and ends with `%dots%` — the same
 * `Lanes`/`Display` animation placeholders `crawler.ts` uses for its own
 * no-progress-number phases (`'Scraping%dots%'`, etc.) — `riffle()` animates
 * them in `Lanes`' non-verbose (single overwriting line) mode, and strips
 * them to nothing in `--verbose` mode. Without them, a phase with no
 * sub-progress renders as fully static text for however long that phase
 * actually takes, indistinguishable from `Lanes`' redraw loop itself having
 * stalled. The `%braille%` prefix matches
 * `formatViewerReadModelProgress`'s, so the label column doesn't jump when
 * a phase line is replaced by its first progress line.
 * @param phase - The phase that just started.
 * @returns A one-line, human-readable phase message wrapped in animation
 *   placeholders.
 * @example
 * ```ts
 * formatViewerReadModelPhase('buildingAnchorFacts');
 * // "%braille% Building anchor facts%dots%"
 * ```
 */
export function formatViewerReadModelPhase(phase: ViewerReadModelBuildPhase): string {
	return `%braille% ${VIEWER_READ_MODEL_PHASE_LABELS[phase]}%dots%`;
}
