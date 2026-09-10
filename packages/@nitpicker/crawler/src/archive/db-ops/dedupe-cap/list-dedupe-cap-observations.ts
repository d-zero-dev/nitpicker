import type { DedupeCapObservationRow } from '../../types.js';
import type { Knex } from 'knex';

import { keysetPaginateById } from '../_shared/keyset-paginate-by-id.js';

const READ_CHUNK_SIZE = 2000;

/** Raw row shape selected per chunk, before mapping to {@link DedupeCapObservationRow}. */
interface RawRow {
	id: number;
	url: string;
	title: string | null;
	description: string | null;
	ogTitle: string | null;
	ogUrl: string | null;
	/** libsql returns BLOB columns as `Uint8Array`, not `Buffer`. */
	bodyHash: Uint8Array;
}

/**
 * Reads back every previously-scraped internal page's raw fields in the
 * exact population a live crawl's `DedupeCapTracker#observe` call site
 * would have fed it, so `CrawlerOrchestrator`'s five resuming-session
 * methods (`append`/`inventory`/`recrawl`/`retryFailed`/`resume`) can
 * replay a prior session's Misra-Gries observations into a fresh tracker
 * instance (see `buildDedupeCapObservation`) instead of restarting every
 * not-yet-capped shape's counter at 0.
 *
 * The WHERE clause reproduces the live observation gate
 * (`!isExternal && !isMetadataOnly && html.length > 0`) using columns that
 * survive a process restart:
 *
 * - `is_external = 0` — external pages carry no useful signal (same
 *   exclusion `computeMetaSignature`'s design already assumes).
 * - `is_target = 1` — the archived equivalent of "not metadata-only": a
 *   metadata-only fetch never invokes the browser and is written with
 *   `is_target = 0` (see `Crawler`'s metadata-only branch), matching the
 *   live gate's `!isMetadataOnly` exactly.
 * - `redirect_dest_id IS NULL` — a redirect source's own body was never
 *   rendered; only the destination page (a separate row) was.
 * - `is_skipped IS NULL OR is_skipped = 0` — a skipped placeholder row
 *   (`source = 'inventory-seed'` etc.) has no rendered body either.
 * - `pm.body_hash IS NOT NULL` — the archived proxy for `html.length > 0`:
 *   `update-page.ts` only ever writes a non-null `body_hash` on the same
 *   `writeHtml && html.length > 0` gate the live site's `precomputedBodyHash`
 *   computation uses, so this column faithfully reconstructs that
 *   condition. Also excludes pre-`body_hash`-migration legacy archives'
 *   un-backfilled rows (`migrate-page-meta-body-hash.ts` adds the column on
 *   every writer open but does not compute values for existing rows) —
 *   understating the replayed count is safe (never over-counts), so no
 *   column-presence guard is needed here.
 *
 * Deliberately does NOT exclude rows already marked
 * `content_items.dedupe_cap_event_id` (the post-hoc marking column) —
 * unlike `body_hash`, that column is only backfilled during a
 * `viewer-build`, not written during a live crawl, so filtering on it here
 * would silently diverge from what the live crawl-time gate actually saw.
 * `DedupeCapTracker#observe` is an O(1) no-op for a shape already in its
 * sticky set regardless, so replaying an already-capped shape's rows costs
 * a discarded observation, never an incorrect one.
 *
 * Rows are read in `ci.id` order (insertion / discovery order) via
 * `keysetPaginateById` — Misra-Gries counting is order-dependent, so
 * replaying in the archive's original discovery order reproduces what the
 * tracker's state would look like had the process never restarted, subject
 * to the same `mapCap` LRU eviction.
 * @param knex - Knex query builder connected to the archive DB.
 * @param onProgress - Called after each chunk, with the highest `ci.id`
 *   scanned so far and the max `ci.id` in the table — mirrors
 *   `getResourceUrlList`'s progress shape (`SetupProgressCallbacks.onChunkProgress`).
 *   Omit for no reporting (tests, and callers that don't need it).
 * @returns Every qualifying page's raw fields, in `ci.id` order.
 */
export async function listDedupeCapObservations(
	knex: Knex,
	onProgress?: (scannedUpToId: number, maxId: number) => void,
): Promise<DedupeCapObservationRow[]> {
	return keysetPaginateById<RawRow, DedupeCapObservationRow>(
		knex,
		'content_items',
		(lastId) =>
			knex('content_items as ci')
				.join('url_refs as ur', 'ur.id', 'ci.url_id')
				.join('page_meta as pm', 'pm.page_id', 'ci.id')
				.leftJoin('text_refs as title_ref', 'title_ref.id', 'pm.title_text_id')
				.leftJoin(
					'text_refs as description_ref',
					'description_ref.id',
					'pm.description_text_id',
				)
				.leftJoin('text_refs as og_title_ref', 'og_title_ref.id', 'pm.og_title_text_id')
				.leftJoin('url_refs as og_url_ur', 'og_url_ur.id', 'pm.og_url_id')
				.where('ci.id', '>', lastId)
				.andWhere('ci.scraped', 1)
				.andWhere('ci.is_external', 0)
				.andWhere('ci.is_target', 1)
				.whereNull('ci.redirect_dest_id')
				.where((qb) => {
					qb.whereNull('ci.is_skipped').orWhere('ci.is_skipped', 0);
				})
				.whereNotNull('pm.body_hash')
				.orderBy('ci.id', 'asc')
				.limit(READ_CHUNK_SIZE)
				.select(
					'ci.id as id',
					'ur.url as url',
					'title_ref.text as title',
					'description_ref.text as description',
					'og_title_ref.text as ogTitle',
					'og_url_ur.url as ogUrl',
					'pm.body_hash as bodyHash',
				),
		(row) => ({
			url: row.url,
			title: row.title,
			description: row.description,
			ogTitle: row.ogTitle,
			ogUrl: row.ogUrl,
			// libsql returns BLOB columns as `Uint8Array`, not `Buffer` —
			// `DedupeCapTracker#observe` compares hashes via `Buffer#equals`,
			// so this must be a real `Buffer`.
			bodyHash: Buffer.from(row.bodyHash),
		}),
		onProgress,
	);
}
