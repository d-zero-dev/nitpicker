import type { SummaryResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { getSummary } from './get-summary.js';
import { getViewerSummary } from './get-viewer-summary.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches to `getViewerSummary` (the `viewer_summary` read-model fast
 * path) when current, else `getSummary` (the legacy full aggregation).
 *
 * Unlike `/api/pages`'/`/api/links`'s route-level dispatch (which also
 * weighs filter-shape compatibility), summary has no request parameters
 * that could force a legacy fallback — the choice is purely "is the read
 * model current or not" — and this same choice is needed identically by
 * three independent callers (the viewer route, the CLI `query summary`
 * command, and the MCP `get_summary`/`open_archive` tools). Centralising it
 * here avoids repeating the same two-line branch in each of those packages.
 * @param accessor - The archive accessor to query.
 * @returns The summary result, from whichever backend is currently valid.
 * @example
 * // Callers never need to check isViewerReadModelCurrent themselves:
 * const summary = await getSummaryFastPath(accessor);
 */
export async function getSummaryFastPath(
	accessor: ArchiveAccessor,
): Promise<SummaryResult> {
	return (await isViewerReadModelCurrent(accessor))
		? getViewerSummary(accessor)
		: getSummary(accessor);
}
