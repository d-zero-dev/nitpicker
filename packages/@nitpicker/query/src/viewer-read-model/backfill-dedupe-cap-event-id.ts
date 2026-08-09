import type { ArchiveAccessor } from '@nitpicker/crawler';

import { computeShapeKey } from '@nitpicker/crawler';

const CHUNK_SIZE = 500;

/**
 * Recomputes `content_items.dedupe_cap_event_id` for the whole archive:
 * matches every internal page's URL against the shapes `--dedupe-cap`
 * confirmed as same-cluster traps during crawl, and points each matching
 * page at the `dedupe_cap_events` row that captured its shape.
 *
 * Crawl-time capping is opt-in and its judgment window is bounded by actual
 * fetches (the shape's `metaSig` can only be known after fetching a few
 * matching pages — see `DedupeCapTracker`), so pages discovered before a
 * shape became sticky are never rejected at enqueue time and still get
 * scraped/recorded. This backfill is the deliberate trade-off's other half:
 * once `dedupe_cap_events` names a shape, every matching page — regardless
 * of when it was crawled relative to the cap firing — is marked here so
 * `query`/MCP/viewer can filter them out after the fact.
 *
 * Unlike {@link import('./backfill-alias-of-id.js').backfillAliasOfId}, this
 * is a simple key-equality match (`computeShapeKey(url) === shape_key`), not
 * a union-find closure over multiple equivalence relations — a URL either
 * decomposes to a captured shape or it does not, and shapes never merge.
 * The candidate set is also broader: every `is_external = 0` row regardless
 * of `scraped` (a still-queued page can be marked too, since its URL alone
 * is enough to compute its shape) or title presence (unlike alias matching,
 * this needs no page content).
 *
 * **Full recompute, not backfill-only**: resets every existing
 * `dedupe_cap_event_id` to `NULL` and recomputes from the current
 * `dedupe_cap_events` rows on every call — the same reasoning as
 * `backfillAliasOfId`: a re-crawl (`--append`/`--retry-failed`) can add both
 * new pages matching an existing shape and new `dedupe_cap_events` rows
 * entirely, so a fill-only design would miss both.
 *
 * When `dedupe_cap_events` is empty, this returns immediately without
 * touching `content_items` at all — and not merely as a heuristic. Every
 * connection runs with `PRAGMA foreign_keys = ON` (`init-schema.ts`), and
 * `content_items.dedupe_cap_event_id REFERENCES dedupe_cap_events(id)` is
 * `DEFERRABLE INITIALLY DEFERRED`, so the constraint is still checked at
 * transaction commit — no row can hold a non-null value referencing an id
 * that does not exist. An empty `dedupe_cap_events` therefore *guarantees*
 * zero marked rows, not just "probably none because the table is
 * append-only." This keeps the common case — every archive that never used
 * `--dedupe-cap` — free of the full-table scan a
 * `content_items.dedupe_cap_event_id IS NOT NULL` predicate would otherwise
 * cost on every `viewer-build`/crawl-completion run (the column has no
 * index — see `create-entity-tables.ts`'s DDL comment).
 * @param accessor - Writable archive accessor.
 * @param onProgress - Optional callback invoked after each write chunk with
 *   `(processed, total)` counts, for archives large enough that visible
 *   progress matters.
 * @example
 * ```ts
 * await backfillDedupeCapEventId(accessor, (processed, total) => {
 *   console.error(`dedupe_cap_event_id backfill: ${processed}/${total}`);
 * });
 * ```
 */
export async function backfillDedupeCapEventId(
	accessor: ArchiveAccessor,
	onProgress?: (processed: number, total: number) => void,
): Promise<void> {
	const knex = accessor.getKnex();

	const eventRows = (await knex('dedupe_cap_events')
		.select('id', 'shape_key')
		.orderBy('id', 'asc')) as { id: number; shape_key: string }[];

	if (eventRows.length === 0) {
		return;
	}

	// Reset before recomputing so a page that no longer matches any captured
	// shape (the shape's sample changed across a re-crawl, in principle)
	// never keeps a stale pointer from a previous run — every write below is
	// therefore always into an already-NULL cell. Only reached once we know
	// `dedupe_cap_events` is non-empty, so this full-table scan is paid only
	// by archives that actually used `--dedupe-cap`.
	await knex('content_items')
		.whereNotNull('dedupe_cap_event_id')
		.update({ dedupe_cap_event_id: null });

	// A shape could in principle be recorded more than once (e.g. a shape
	// that was already sticky from a preloaded set gets re-observed and
	// re-inserted across `--append`/`--retry-failed` runs). Iterating in
	// ascending `id` order and overwriting the map means the highest id —
	// the most recent event — wins for that shape.
	const eventIdByShapeKey = new Map<string, number>();
	for (const row of eventRows) {
		eventIdByShapeKey.set(row.shape_key, row.id);
	}

	const candidates = (await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.where('ci.is_external', 0)
		.select('ci.id as id', 'ur.url as url')) as { id: number; url: string }[];

	const assignments: { id: number; eventId: number }[] = [];
	for (const candidate of candidates) {
		const shapeKey = computeShapeKey(candidate.url);
		if (shapeKey === null) continue;
		const eventId = eventIdByShapeKey.get(shapeKey);
		if (eventId !== undefined) {
			assignments.push({ id: candidate.id, eventId });
		}
	}

	const total = assignments.length;
	if (total === 0) {
		return;
	}

	let processed = 0;
	for (let start = 0; start < assignments.length; start += CHUNK_SIZE) {
		const chunk = assignments.slice(start, start + CHUNK_SIZE);
		await knex.transaction(async (trx) => {
			for (const assignment of chunk) {
				await trx('content_items')
					.where('id', assignment.id)
					.update({ dedupe_cap_event_id: assignment.eventId });
			}
		});
		processed += chunk.length;
		onProgress?.(processed, total);
	}
}
