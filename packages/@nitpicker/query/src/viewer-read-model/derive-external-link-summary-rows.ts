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
 *
 * `computeAnchorFactRows` yields `anchors` in `source.id`-range chunks, so
 * this only ever sees one chunk's facts — it deliberately does NOT
 * accumulate across chunks. A cross-chunk JS accumulator (e.g. threading a
 * running summary map through each call) would hold one entry per distinct
 * external destination in memory for the entire build — defeating
 * `computeAnchorFactRows`'s bounded-memory chunking — and re-cloning that
 * running set per call would make the fold cost `O(chunks × distinct
 * destinations)` instead of `O(anchors)`. The caller instead passes each
 * chunk's rows to `upsertExternalLinkRows`, which merges them into
 * `viewer_external_links` via an `ON CONFLICT` upsert, so cross-chunk
 * accumulation happens in SQLite, not in a JS `Map` this function would
 * otherwise have to keep alive for the whole build.
 * @param anchorFacts - One chunk of `viewer_anchor_facts` rows (as yielded
 *   by `computeAnchorFactRows`).
 * @returns One row per unique external destination in this chunk, with
 *   `referrer_count` counting only this chunk's referrers — the caller is
 *   responsible for summing across chunks at insert time.
 * @example
 * for await (const anchorFactChunk of computeAnchorFactRows(trx)) {
 *   await upsertExternalLinkRows(trx, deriveExternalLinkSummaryRows(anchorFactChunk));
 * }
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
				dest_url_ref_id: fact.dest_url_ref_id,
				status: fact.status,
				referrer_count: 1,
			});
		}
	}
	return [...summaries.values()];
}
