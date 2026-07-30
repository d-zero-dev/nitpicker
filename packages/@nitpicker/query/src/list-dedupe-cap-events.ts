import type { DedupeCapEventEntry, ListDedupeCapEventsOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { resolveListLimit } from './resolve-list-limit.js';
import { resolveListOffset } from './resolve-list-offset.js';

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

	const items: DedupeCapEventEntry[] = rows.map((row) => ({
		...row,
		body_hash: row.body_hash ? Buffer.from(row.body_hash).toString('hex') : null,
	}));

	return { items, total };
}
