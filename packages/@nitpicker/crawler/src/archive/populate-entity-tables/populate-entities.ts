import type { PageDomPathResolver } from './populate-image-items.js';
import type { Knex } from 'knex';

import { populateAnchorEdges } from './populate-anchor-edges.js';
import { populateContentItems } from './populate-content-items.js';
import { populateImageItems } from './populate-image-items.js';
import { populatePageMeta } from './populate-page-meta.js';
import { populateResourceItems } from './populate-resource-items.js';
import { populateResourceRefEdges } from './populate-resource-ref-edges.js';

/**
 * Runs the six 0.13 entity/edge populates (issue #193) in dependency
 * order against an already-connected archive.
 *
 * Order rationale:
 *
 * 1. **`content_items`** — every downstream populate's FKs reference
 *    `content_items(id)`. Must land first so the FKs are valid at
 *    COMMIT time. `redirect_dest_id` is `DEFERRABLE INITIALLY DEFERRED`
 *    (see {@link ../create-entity-tables.ts}) so a redirect
 *    source inserted before its destination is validated only at
 *    COMMIT — the insert order within this populate is not
 *    load-bearing.
 * 2. **`page_meta`** — FK to `content_items(id)`.
 * 3. **`resource_items`** — required before `resource_ref_edges`.
 * 4. **`anchor_edges`** — FKs to `content_items(id)` on both
 *    sides.
 * 5. **`resource_ref_edges`** — FKs to `resource_items(id)` and
 *    `content_items(id)`.
 * 6. **`image_items`** — FK to `content_items(id)`; the
 *    dom-path text_refs upsert is scoped to this populate so re-runs are
 *    self-contained.
 *
 * Every sub-populate is independently idempotent via `INSERT OR IGNORE` on
 * its natural key or PK. On a **re-crawl** (`crawl --append` /
 * `--retry-failed` / `--inventory` all UPDATE existing `pages` /
 * `resources` rows in place, and `#insertPage` deletes + re-inserts
 * `anchors` / `images` per page), running populate again against the
 * previously-populated archive would leave `content_items` / `page_meta`
 * / `resource_items` at their FIRST-crawl values (source-priority
 * upgrades, refreshed status, changed metadata never propagate) and
 * `anchor_edges` / `image_items` / `resource_ref_edges` would keep stale
 * rows keyed by the now-deleted legacy ids. To keep the reader-side
 * view of the archive faithful to `pages` / `resources` on re-crawl,
 * every entity + edge table is TRUNCATEd (in child-first order so no FK
 * check trips) at the top of this function before the six sub-populates
 * re-insert from the current legacy state. Ref tables (`url_refs`,
 * `text_refs`, `content_type_refs`, `header_*`) are NOT truncated —
 * they are content-addressable and additive; re-inserting the same
 * value hits `INSERT OR IGNORE` and is a no-op.
 *
 * The whole invocation is expected to run inside one writer transaction
 * with `.bak` protection at the caller level (a single WAL transaction
 * with `.bak` rollback on failure);
 * this function does not open its own transaction so the
 * caller controls the boundary — see {@link
 * ../populate-ref-tables/populate-refs.ts} for the same convention.
 *
 * **`PRAGMA foreign_keys = ON` is REQUIRED** on the underlying
 * connection before this function is called. `content_items.redirect_dest_id`
 * is `DEFERRABLE INITIALLY DEFERRED` (see
 * {@link ../create-entity-tables.ts}); without foreign-key
 * enforcement libsql commits `content_items` rows whose `redirect_dest_id`
 * points at a non-existent page and the deferrable-FK-enforcement-at-COMMIT
 * invariant is silently broken. The
 * migration script sets the pragma explicitly; any other caller must do
 * the same.
 * HTML BLOB reads happen inline inside {@link populateImageItems} against
 * the same `trx` — no `getPageHtml` callback here — because a callback
 * that routed through `Database.getHtmlOfPageById` would re-enter the
 * connection pool from inside this writer transaction and deadlock on
 * libsql's single writer connection. See `./populate-image-items.ts` for
 * the detailed rationale.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @param resolvePageDomPaths - Callback that returns dom_path strings
 *   for one page's images. Injected rather than hard-coded so
 *   `@nitpicker/crawler` does not become a jsdom consumer at runtime.
 * @example
 * const archive = await Archive.open(archivePath);
 * const knex = archive.getKnex();
 * await knex.transaction(async (trx) => {
 *   await populateEntityTables(trx, jsdomResolver);
 * });
 * await archive.write();
 */
export async function populateEntityTables(
	trx: Knex,
	resolvePageDomPaths: PageDomPathResolver,
): Promise<void> {
	// Truncate child-first so no outgoing FK check ever sees a broken
	// reference mid-delete. Order is: leaf edge/entity tables that have
	// no incoming FKs (`image_items`, `anchor_edges`, `resource_ref_edges`),
	// then the parent entities they referenced (`page_meta` and
	// `resource_items`; `page_meta` references `content_items` so it
	// must be dropped before `content_items`; `resource_items` was
	// pointed at by `resource_ref_edges` which is now empty), and
	// finally `content_items` itself — the only remaining incoming
	// reference is its own DEFERRABLE INITIALLY DEFERRED
	// `redirect_dest_id`, which is validated at COMMIT so a mid-trx
	// wipe-and-refill is legal. No external table has an enforced FK
	// into `content_items` (viewer read-model tables and
	// `analysis_violations` reference `pages(id)` or hold logical-only
	// pointers), so the truncation stops here.
	await trx('image_items').delete();
	await trx('anchor_edges').delete();
	await trx('resource_ref_edges').delete();
	await trx('page_meta').delete();
	await trx('resource_items').delete();
	await trx('content_items').delete();

	await populateContentItems(trx);
	await populatePageMeta(trx);
	await populateResourceItems(trx);
	await populateAnchorEdges(trx);
	await populateResourceRefEdges(trx);
	await populateImageItems(trx, resolvePageDomPaths);
}
