import type { ResourceInsertRows } from './types.js';
import type { Knex } from 'knex';

import { NULL_STATUS_SENTINEL } from './null-status-sentinel.js';

/** Rows read per `resource_items`/`resource_ref_edges` scan chunk, by default. */
const READ_CHUNK_SIZE = 20_000;

/**
 * Computes insert rows for both resource read-model tables
 * (`viewer_resources`, `viewer_resource_stats`).
 *
 * Reads the 0.13 `resource_items` table LEFT JOIN `resource_ref_edges`
 * (which already carries a per-`(resource_id, page_id)` `count`) and
 * resolves the URL through `url_refs`. Summing `resource_ref_edges.count`
 * yields the "1 per unique referrer page" semantics — the 0.13 format
 * populates `resource_ref_edges.count = 1` for every distinct
 * `(resource_id, page_id)` pair, so `SUM(count)` equals a `COUNT(*)` over
 * per-referrer rows.
 *
 * Chunking is plain `id`-based keyset pagination
 * (`WHERE resource_items.id > :last ORDER BY resource_items.id LIMIT :size`),
 * safe because the `GROUP BY` key is exactly `resource_items`'s own primary
 * key: one output row corresponds to exactly one `resource_items` row.
 *
 * `referrer_count` uses `SUM(rre.count)` rather than `COUNT(*)`: the LEFT
 * JOIN produces one null-count row per zero-referrer resource, so
 * `COUNT(*)` would count that phantom row as 1 instead of 0.
 * `coalesce(sum, 0)` guards the same null → 0 path.
 *
 * `is_unused` preserves `listUnusedResources`'s definition (external
 * resources are never "unused" candidates).
 * @param trx - An open Knex transaction (a plain `Knex` instance also works,
 *   e.g. in tests).
 * @param chunkSize - Maximum `resource_items` rows read per chunk. Must be
 *   positive.
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
			url: string | null;
			statusText: string | null;
			contentTypeRaw: string | null;
			contentLength: number | null;
			compress: string | null;
			cdn: string | null;
			referrerCount: string | number | null;
		}[] = await trx('resource_items as ri')
			.leftJoin('url_refs as ur', 'ur.id', 'ri.url_id')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'ri.content_type_id')
			.leftJoin('resource_ref_edges as rre', 'rre.resource_id', 'ri.id')
			.where('ri.id', '>', lastId)
			.groupBy('ri.id')
			.orderBy('ri.id', 'asc')
			.limit(chunkSize)
			.select(
				'ri.id as id',
				'ri.is_external as isExternal',
				'ri.status as status',
				'ri.source as source',
				'ur.url as url',
				'ri.status_text as statusText',
				'ctr.raw as contentTypeRaw',
				'ri.content_length as contentLength',
				'ri.compress as compress',
				'ri.cdn as cdn',
				trx.raw('coalesce(sum("rre"."count"), 0) as "referrerCount"'),
			);

		if (rows.length === 0) {
			return;
		}
		lastId = rows.at(-1)!.id;

		const resources = rows.map((row) => {
			const isExternal = row.isExternal ? 1 : 0;
			const referrerCount = Number(row.referrerCount ?? 0);
			const statusSortKey = row.status ?? NULL_STATUS_SENTINEL;
			return {
				resource_id: row.id,
				is_external: isExternal,
				status: row.status,
				status_sort_key: statusSortKey,
				status_desc_key: -statusSortKey,
				source: row.source as ResourceInsertRows['resources'][number]['source'],
				is_unused: isExternal === 0 && referrerCount === 0 ? 1 : 0,
				// NULL-sentinel substitution for keyset sortability — see
				// `viewer_resources`'s DDL comment ('' / -1 sort where SQL
				// NULLs would; display re-fetches the true nullable values).
				status_text: row.statusText ?? '',
				content_type_raw: row.contentTypeRaw ?? '',
				content_length: row.contentLength ?? -1,
				compress: row.compress ?? '',
				cdn: row.cdn ?? '',
				referrer_count: referrerCount,
				// A blob-routed resource (identity is a large `data:` URI, not
				// a URL) has `url === null`; sort_key is NOT NULL, so it falls
				// back to the empty string, sorting first (mirrors
				// `sort-resources-by-url.ts`'s report-side convention).
				url_sort_key: row.url ?? '',
			};
		});

		const stats = rows.map((row) => ({
			resource_id: row.id,
			referrer_count: Number(row.referrerCount ?? 0),
		}));

		yield { resources, stats };
	}
}
