import type { DedupeCapEventEntry, ListDedupeCapEventsOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { hasDedupeCapEventIdColumn } from './has-dedupe-cap-event-id-column.js';
import { resolveListLimit } from './resolve-list-limit.js';
import { resolveListOffset } from './resolve-list-offset.js';
import { SQLITE_IN_CHUNK } from './sqlite-in-chunk.js';

/**
 * Tallies `content_items.dedupe_cap_event_id` per event id, chunked at
 * {@link SQLITE_IN_CHUNK} — `eventIds` comes from the caller's page (up to
 * `ALL_DEDUPE_CAP_EVENTS_LIMIT`'s 10,000 in the viewer route), which can
 * exceed SQLite's `SQLITE_MAX_VARIABLE_NUMBER` (999) in a single `whereIn`.
 * @param knex - Knex query builder connected to the archive DB.
 * @param eventIds - The `dedupe_cap_events.id` values to tally.
 * @returns Map of event id to captured page count (only ids with at least
 *   one captured page are present — absence means `0`).
 */
async function countCapturedPagesByEventId(
	knex: Knex,
	eventIds: readonly number[],
): Promise<Map<number, number>> {
	const capturedCountByEventId = new Map<number, number>();
	for (let i = 0; i < eventIds.length; i += SQLITE_IN_CHUNK) {
		const chunk = eventIds.slice(i, i + SQLITE_IN_CHUNK);
		const countRows = (await knex('content_items')
			.whereIn('dedupe_cap_event_id', chunk)
			.groupBy('dedupe_cap_event_id')
			.select('dedupe_cap_event_id as eventId')
			.count('id as count')) as { eventId: number; count: number }[];
		for (const row of countRows) {
			capturedCountByEventId.set(row.eventId, Number(row.count));
		}
	}
	return capturedCountByEventId;
}

/**
 * Resolves which of `sampleUrls` have a scraped `content_items` row, chunked
 * at {@link SQLITE_IN_CHUNK} for the same reason as
 * {@link countCapturedPagesByEventId}.
 * @param knex - Knex query builder connected to the archive DB.
 * @param sampleUrls - The `dedupe_cap_events.sample_url` values to check.
 * @returns Set of URLs that are archived (scraped) in this archive.
 */
async function findArchivedSampleUrls(
	knex: Knex,
	sampleUrls: readonly string[],
): Promise<Set<string>> {
	const archivedSampleUrls = new Set<string>();
	const uniqueUrls = [...new Set(sampleUrls)];
	for (let i = 0; i < uniqueUrls.length; i += SQLITE_IN_CHUNK) {
		const chunk = uniqueUrls.slice(i, i + SQLITE_IN_CHUNK);
		const archivedRows = (await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.where('ci.scraped', 1)
			.whereIn('ur.url', chunk)
			.select('ur.url as url')) as { url: string }[];
		for (const row of archivedRows) {
			archivedSampleUrls.add(row.url);
		}
	}
	return archivedSampleUrls;
}

/**
 * List recorded same-cluster-cap audit rows from the archive, newest first.
 *
 * Surfaces the `dedupe_cap_events` table (opt-in `--dedupe-cap`, issue
 * #208) so the CLI / MCP / viewer can answer "which URL shapes did this
 * crawl confirm as self-generating traps, and how many anchors did the cap
 * reject" — see `packages/@nitpicker/crawler/src/archive/create-adjunct-tables.ts`'s
 * DDL JSDoc for the write-side contract.
 *
 * Tolerates a missing `dedupe_cap_events` table: archives that predate the
 * table and read-only `stub` connections both arrive here with no table.
 * Returns `{ items: [], total: 0 }` rather than throwing — mirrors
 * `listNetworkOutages`'s handling of the same situation.
 *
 * Unlike `listNetworkOutages`, a `null` `rejected_count` (crawl never
 * reached `crawlEnd`) is returned as-is, not resolved to a synthetic value
 * — see `DedupeCapEventEntry.rejected_count`'s JSDoc for why no such
 * resolution is needed here.
 *
 * Also resolves two derived fields per event, each with its own additional
 * query (batched across every returned row, not per-row): `captured_page_count`
 * (post-hoc marking's tally, degrading to `0` on an archive predating that
 * feature — see `hasDedupeCapEventIdColumn`) and `sample_url_archived`
 * (whether `sample_url` itself has a scraped `content_items` row).
 *
 * Read-only — safe against viewer / stub-mode archives.
 * @param accessor - The archive accessor to query.
 * @param options - Pagination options.
 * @returns Paginated list of dedupe-cap events ordered by `detected_at DESC`.
 * @example
 * ```ts
 * const { items, total } = await listDedupeCapEvents(accessor, { limit: 10 });
 * for (const event of items) {
 *   console.log(`${event.shape_key}: ${event.rejected_count ?? 'unknown'} rejected`);
 * }
 * ```
 */
export async function listDedupeCapEvents(
	accessor: ArchiveAccessor,
	options: ListDedupeCapEventsOptions = {},
): Promise<{ items: DedupeCapEventEntry[]; total: number }> {
	const knex = accessor.getKnex();
	const limit = resolveListLimit(options.limit, 100);
	const offset = resolveListOffset(options.offset);

	const hasTable = await knex.schema.hasTable('dedupe_cap_events');
	if (!hasTable) {
		return { items: [], total: 0 };
	}

	const countResult = (await knex('dedupe_cap_events').count('id as total')) as {
		total: number;
	}[];
	const total = Number(countResult[0]?.total ?? 0);

	const rows = (await knex('dedupe_cap_events')
		.select(
			'id',
			'shape_key',
			'sample_url',
			'body_hash',
			'effective_threshold',
			'observed_count',
			'detected_at',
			'rejected_count',
		)
		.orderBy('detected_at', 'desc')
		.limit(limit)
		.offset(offset)) as {
		id: number;
		shape_key: string;
		sample_url: string;
		body_hash: Uint8Array | null;
		effective_threshold: number;
		observed_count: number;
		detected_at: number;
		rejected_count: number | null;
	}[];

	const hasDedupeCapColumn = await hasDedupeCapEventIdColumn(knex);
	const [capturedCountByEventId, archivedSampleUrls] = await Promise.all([
		hasDedupeCapColumn && rows.length > 0
			? countCapturedPagesByEventId(
					knex,
					rows.map((row) => row.id),
				)
			: new Map<number, number>(),
		rows.length > 0
			? findArchivedSampleUrls(
					knex,
					rows.map((row) => row.sample_url),
				)
			: new Set<string>(),
	]);

	const items: DedupeCapEventEntry[] = rows.map((row) => ({
		...row,
		body_hash: row.body_hash ? Buffer.from(row.body_hash).toString('hex') : null,
		captured_page_count: capturedCountByEventId.get(row.id) ?? 0,
		sample_url_archived: archivedSampleUrls.has(row.sample_url),
	}));

	return { items, total };
}
