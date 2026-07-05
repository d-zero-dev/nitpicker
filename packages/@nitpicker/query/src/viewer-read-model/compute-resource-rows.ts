import type { ResourceInsertRows } from './types.js';
import type { Knex } from 'knex';

import { NULL_STATUS_SENTINEL } from './null-status-sentinel.js';

/** Rows read per `resources`/`resources-referrers` scan chunk, by default. */
const READ_CHUNK_SIZE = 20_000;

/**
 * Computes insert rows for both resource read-model tables
 * (`viewer_resources`, `viewer_resource_stats`), reading `resources`
 * left-joined with `resources-referrers` in bounded chunks instead of one
 * unbounded `SELECT` — the only `resources`/`resources-referrers` scan the
 * read-model build performs, mirroring `computeAnchorFactRows`'s "one scan,
 * multiple tables" pattern.
 *
 * Chunking is plain `id`-based keyset pagination
 * (`WHERE resources.id > :last ORDER BY resources.id LIMIT :size`), the same
 * idiom as `readUrlChunks`. This is safe here — unlike
 * `computeAnchorFactRows`'s compound-key aggregation — because the `GROUP
 * BY` key (`resources.id`) is exactly `resources`'s own primary key: one
 * output row always corresponds to exactly one `resources` row, so a
 * `LIMIT` can never stop mid-group.
 *
 * `referrer_count` is `COUNT("resources-referrers"."id")` rather than
 * `COUNT(*)`: the `LEFT JOIN` produces one null-referrer row per
 * zero-referrer resource, and `COUNT(*)` would count that phantom row as 1
 * instead of 0.
 *
 * `is_unused` is lifted verbatim from `listUnusedResources`'s definition
 * (external resources are never "unused" candidates, regardless of referrer
 * count — see that function's docs).
 * @param trx - An open Knex transaction (a plain `Knex` instance also works,
 *   e.g. in tests).
 * @param chunkSize - Maximum `resources` rows read per chunk. Must be
 *   positive — `.limit(0)` would return zero rows on the very first
 *   iteration (indistinguishable from "no more resources", so the generator
 *   would silently yield nothing instead of throwing), and SQLite treats a
 *   negative `LIMIT` as unlimited (silently reintroducing the unbounded
 *   single-query read this chunking exists to avoid). Defaults to
 *   {@link READ_CHUNK_SIZE}; overridable for tests that need to exercise
 *   chunk boundaries against a small fixture.
 * @yields {ResourceInsertRows} One chunk's insert rows for `viewer_resources`
 *   and `viewer_resource_stats`, at most `chunkSize` resources long.
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * for await (const chunk of computeResourceInsertRows(trx)) {
 *   await trx('viewer_resources').insert(chunk.resources);
 * }
 */
export async function* computeResourceInsertRows(
	trx: Knex,
	chunkSize = READ_CHUNK_SIZE,
): AsyncGenerator<ResourceInsertRows> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`computeResourceInsertRows: chunkSize must be positive, got ${chunkSize}`,
		);
	}

	let lastId = 0;
	for (;;) {
		const rows: {
			id: number;
			isExternal: 0 | 1;
			status: number | null;
			source: string;
			url: string;
			referrerCount: string | number;
		}[] = await trx('resources')
			.leftJoin(
				'resources-referrers',
				'resources.id',
				'=',
				'resources-referrers.resourceId',
			)
			.where('resources.id', '>', lastId)
			.groupBy('resources.id')
			.orderBy('resources.id', 'asc')
			.limit(chunkSize)
			.select(
				'resources.id as id',
				'resources.isExternal as isExternal',
				'resources.status as status',
				'resources.source as source',
				'resources.url as url',
			)
			.count('resources-referrers.id as referrerCount');

		if (rows.length === 0) {
			return;
		}
		lastId = rows.at(-1)!.id;

		const resources = rows.map((row) => {
			const isExternal = row.isExternal ? 1 : 0;
			const referrerCount = Number(row.referrerCount);
			const statusSortKey = row.status ?? NULL_STATUS_SENTINEL;
			return {
				resource_id: row.id,
				is_external: isExternal,
				status: row.status,
				status_sort_key: statusSortKey,
				status_desc_key: -statusSortKey,
				source: row.source as ResourceInsertRows['resources'][number]['source'],
				is_unused: isExternal === 0 && referrerCount === 0 ? 1 : 0,
				url_sort_key: row.url,
			};
		});

		const stats = rows.map((row) => ({
			resource_id: row.id,
			referrer_count: Number(row.referrerCount),
		}));

		yield { resources, stats };
	}
}
