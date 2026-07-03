import type { AnchorFactInsertRow, ExternalLinkInsertRow } from './types.js';

/**
 * Derives `viewer_external_links` rows from already-computed
 * {@link AnchorFactInsertRow} rows — no `anchors` scan of its own.
 *
 * `AnchorFactInsertRow` is already deduplicated one row per unique
 * `(source_page_id, dest_page_id)` pair, so the number of `is_external_link`
 * rows sharing a `dest_page_id` IS the distinct-referrer count — equivalent
 * to `COUNT(DISTINCT source.id)` over the raw `anchors` table, but computed
 * by counting already-grouped rows instead of a second aggregation pass.
 * @param anchorFacts - The full `viewer_anchor_facts` row set for this
 *   build (as computed by `computeAnchorFactRows`).
 * @returns One row per unique external destination.
 */
export function deriveExternalLinkSummaryRows(
	anchorFacts: readonly AnchorFactInsertRow[],
): ExternalLinkInsertRow[] {
	const summaries = new Map<number, ExternalLinkInsertRow>();
	for (const fact of anchorFacts) {
		if (!fact.is_external_link) {
			continue;
		}
		const existing = summaries.get(fact.dest_page_id);
		if (existing) {
			existing.referrer_count += 1;
		} else {
			summaries.set(fact.dest_page_id, {
				dest_page_id: fact.dest_page_id,
				dest_url: fact.dest_url_sort_key,
				status: fact.status,
				referrer_count: 1,
			});
		}
	}
	return [...summaries.values()];
}
