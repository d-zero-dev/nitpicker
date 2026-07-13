import type { PageDomPathResolver } from './populate-image-items.js';
import type { Knex } from 'knex';

import { populateAnchorEdges } from './populate-anchor-edges.js';
import { populateContentItems } from './populate-content-items.js';
import { populateImageItems } from './populate-image-items.js';
import { populatePageMeta } from './populate-page-meta.js';
import { populateResourceItems } from './populate-resource-items.js';
import { populateResourceRefEdges } from './populate-resource-ref-edges.js';

/**
 * Runs the six Phase 6-D sub-steps (issue #193) in the plan-specified
 * order against an already-connected archive.
 *
 * Order rationale:
 *
 * 1. **`content_items`** (6-D-1) — every downstream step's FKs reference
 *    `content_items(id)`. Must land first so the FKs are valid at
 *    COMMIT time. `redirect_dest_id` is `DEFERRABLE INITIALLY DEFERRED`
 *    (see {@link ../create-phase6c-entity-tables.ts}) so a redirect
 *    source inserted before its destination is validated only at
 *    COMMIT — the intra-step insert order within this step is not
 *    load-bearing.
 * 2. **`page_meta`** (6-D-2) — FK to `content_items(id)`.
 * 3. **`resource_items`** (6-D-3) — required before `resource_ref_edges`.
 * 4. **`anchor_edges`** (6-D-4) — FKs to `content_items(id)` on both
 *    sides.
 * 5. **`resource_ref_edges`** (6-D-5) — FKs to `resource_items(id)` and
 *    `content_items(id)`.
 * 6. **`image_items`** (6-D-6) — FK to `content_items(id)`; the
 *    dom-path text_refs upsert is scoped to this step so re-runs are
 *    self-contained.
 *
 * Every sub-step is independently idempotent via `INSERT OR IGNORE` on
 * its natural key or PK. Running this orchestrator twice on the same
 * archive produces the same rows — no phase marker table is used.
 *
 * The whole invocation is expected to run inside one writer transaction
 * with `.bak` protection at the caller level (matching the plan's
 * "All steps run inside a single WAL transaction with `.bak` rollback
 * on failure"); this function does not open its own transaction so the
 * caller controls the boundary — see {@link
 * ../phase6b/populate-phase6b-refs.ts} for the same convention.
 *
 * **`PRAGMA foreign_keys = ON` is REQUIRED** on the underlying
 * connection before this function is called. `content_items.redirect_dest_id`
 * is `DEFERRABLE INITIALLY DEFERRED` (see
 * {@link ../create-phase6c-entity-tables.ts}); without foreign-key
 * enforcement libsql commits `content_items` rows whose `redirect_dest_id`
 * points at a non-existent page and the invariant the plan calls out
 * (deferrable FK enforcement at COMMIT) is silently broken. The
 * migration script sets the pragma explicitly; any other caller must do
 * the same.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @param resolvePageDomPaths - Callback that returns dom_path strings
 *   for one page's images. Injected rather than hard-coded so
 *   `@nitpicker/crawler` does not become a jsdom consumer at runtime.
 * @param getPageHtml - Callback returning the HTML string for one
 *   `pages.id`. Typically wraps `Database.getHtmlOfPageById`.
 * @example
 * const archive = await Archive.open(archivePath);
 * const knex = archive.getKnex();
 * const db = archive.getDatabase();
 * await knex.transaction(async (trx) => {
 *   await populatePhase6DEntities(
 *     trx,
 *     jsdomResolver,
 *     (pageId) => db.getHtmlOfPageById(pageId),
 *   );
 * });
 * await archive.write();
 */
export async function populatePhase6DEntities(
	trx: Knex,
	resolvePageDomPaths: PageDomPathResolver,
	getPageHtml: (pageId: number) => Promise<string | null>,
): Promise<void> {
	await populateContentItems(trx);
	await populatePageMeta(trx);
	await populateResourceItems(trx);
	await populateAnchorEdges(trx);
	await populateResourceRefEdges(trx);
	await populateImageItems(trx, resolvePageDomPaths, getPageHtml);
}
