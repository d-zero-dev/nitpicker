import type { ArchiveAccessor } from '@nitpicker/crawler';

import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Throws an actionable error when the viewer read model is missing or
 * stale on this accessor, instead of letting a query that depends on it
 * (e.g. reading `viewer_anchor_facts`) fail with a raw `no such table`
 * error or silently read a stale snapshot.
 *
 * Unlike `isViewerReadModelCurrent`'s other callers (`get-*-fast-path.ts`),
 * which branch to a legacy SQL fallback when the read model isn't current,
 * `listInboundLinks` has no legacy fallback (see its docs, #235) — the
 * `viewer_anchor_facts.dest_page_id` index is the only way to answer
 * "who links here" without a full `anchor_edges` scan, so there is nothing
 * correct to fall back to. This mirrors `requireAliasOfIdColumn`'s pattern
 * of failing closed with a `viewer-build` pointer rather than branching.
 *
 * Never call this from a route/query that must keep working during a live
 * crawl (stub mode) — the read model cannot exist there (`buildViewerReadModel`
 * refuses read-only accessors, and `viewer-build` refuses stub directories),
 * so this always throws in stub mode. Callers needing stub-mode compatibility
 * must check `context.mode` and skip the read-model-dependent query entirely
 * instead of calling this guard.
 * @param accessor - The archive accessor to check.
 * @throws {Error} If the viewer read model is missing or built under a
 *   stale schema version.
 */
export async function requireViewerReadModel(accessor: ArchiveAccessor): Promise<void> {
	if (!(await isViewerReadModelCurrent(accessor))) {
		throw new Error(
			"This archive's viewer read model is missing or stale. " +
				'Run `viewer-build` against it once to build it first.',
		);
	}
}
