import type { AnchorEdgeRowInProgress, AnchorInputRow } from './types.js';

/**
 * Collapses consecutive `anchors`-shaped rows into `anchor_edges` rows by
 * `(pageId, hrefId)` (issue #193 step 6-D-4).
 *
 * **Input contract**: `rows` MUST be sorted by `(pageId, hrefId, id)`
 * ascending. The caller (`populate-anchor-edges.ts`) achieves this via a
 * single keyset scan `ORDER BY pageId, hrefId, id` over `anchors`.
 *
 * The `id`-then-key sort matters because the plan's dedup rule is
 * "first instance wins": the smallest `anchors.id` for a given
 * `(pageId, hrefId)` pair contributes its `hash` and `textContent` to
 * the edge; every subsequent duplicate is counted but its body is
 * discarded. A naive `min(hash) GROUP BY pageId, hrefId` would pick the
 * lexicographically smallest hex string (uniformly distributed) rather
 * than the earliest occurrence, so the pass has to happen in JS.
 *
 * The generator yields one {@link AnchorEdgeRowInProgress} per distinct
 * pair as soon as the next pair boundary is observed. Emitting eagerly
 * keeps peak memory bounded to O(1) — the collapser holds at most one
 * open pair state at a time.
 *
 * `first_text_id` is intentionally left `null` here; the caller resolves
 * it in a second pass after all edges are known (see
 * `populate-anchor-edges.ts`). The `first_hash` field is set to the
 * first row's `hash` verbatim; a first row with `hash === null` results
 * in `first_hash = null` on the edge (rare but possible on legacy
 * archives that failed to compute a hash).
 * @param rows - Anchor input rows sorted by `(pageId, hrefId, id)`.
 * @yields {AnchorEdgeRowInProgress} One entry per distinct
 *   `(pageId, hrefId)` pair in the input.
 * @example
 * const edges = [...collapseAnchorRows([
 *   { id: 1, pageId: 10, hrefId: 20, hash: 'a', textContent: 'first' },
 *   { id: 2, pageId: 10, hrefId: 20, hash: 'b', textContent: 'second' },
 *   { id: 3, pageId: 10, hrefId: 30, hash: 'c', textContent: 'x' },
 * ])];
 * // edges[0] = { page_id: 10, href_page_id: 20, count: 2, first_hash: 'a', ... }
 * // edges[1] = { page_id: 10, href_page_id: 30, count: 1, first_hash: 'c', ... }
 */
export function* collapseAnchorRows(
	rows: Iterable<AnchorInputRow>,
): Generator<AnchorEdgeRowInProgress> {
	let openPageId: number | null = null;
	let openHrefId: number | null = null;
	let openCount = 0;
	let openFirstHash: string | null = null;
	let openFirstTextContent: string | null = null;
	let openLastId: number | null = null;

	for (const row of rows) {
		if (openPageId === row.pageId && openHrefId === row.hrefId) {
			// Same pair — assert monotonically-increasing `id` so callers
			// that regress the `ORDER BY id` fail loudly instead of
			// silently producing the wrong "first instance". The count-
			// based acceptance check does not catch this (it only sums
			// counts, not first_hash values), so the collapser defends
			// its own precondition.
			if (openLastId !== null && row.id <= openLastId) {
				throw new Error(
					`collapseAnchorRows: input not sorted by id within (pageId=${row.pageId}, hrefId=${row.hrefId}) — saw id=${row.id} after id=${openLastId}. Caller must ORDER BY pageId, hrefId, id ASC.`,
				);
			}
			openLastId = row.id;
			openCount += 1;
			continue;
		}
		if (openPageId !== null && openHrefId !== null) {
			yield {
				page_id: openPageId,
				href_page_id: openHrefId,
				count: openCount,
				first_hash: openFirstHash,
				first_textContent: openFirstTextContent,
			};
		}
		openPageId = row.pageId;
		openHrefId = row.hrefId;
		openCount = 1;
		openFirstHash = row.hash;
		openFirstTextContent = row.textContent;
		openLastId = row.id;
	}
	if (openPageId !== null && openHrefId !== null) {
		yield {
			page_id: openPageId,
			href_page_id: openHrefId,
			count: openCount,
			first_hash: openFirstHash,
			first_textContent: openFirstTextContent,
		};
	}
}
