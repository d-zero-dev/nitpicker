import type { ResourceStreamRow } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/** `resource_items` rows read per keyset chunk, by default. */
const READ_CHUNK_SIZE = 20_000;

/**
 * Streams every `resource_items` row for the Resources report sheet.
 *
 * Plain `resource_items.id` keyset pagination — a 1:1 projection (one
 * output row per `resource_items` row via a `GROUP BY ri.id` correlated
 * sum), matching `computeResourceInsertRows`'s chunking rationale. No read
 * model dependency: `resource_items`/`resource_ref_edges` are write-model
 * tables, read the same way `list-resources.ts` does.
 *
 * Deliberately excludes referrer *URLs* (only the count) — fetching them
 * per resource here, even in a single chunk-wide query, would multiply this
 * function's 1:1 row contract into a fan-out the caller does not expect.
 * Callers needing the URL list should batch-fetch it separately via
 * `getResourceReferrerUrlsByResourceIds`, the same two-step shape
 * `listViewerPages` + `getOutboundLinkFactsByPageIds` uses for Page List.
 * @param accessor - The archive accessor to query.
 * @param chunkSize - `resource_items` rows read per chunk. Must be positive.
 * @yields One chunk's rows, in `resource_items.id` order.
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * for await (const chunk of streamAllResourcesRaw(accessor)) {
 *   const urls = await getResourceReferrerUrlsByResourceIds(
 *     accessor,
 *     chunk.map((row) => row.resourceId),
 *   );
 *   for (const row of chunk) {
 *     sheet.appendRow(toResourceRow(row, urls.get(row.resourceId) ?? []));
 *   }
 * }
 */
export async function* streamAllResourcesRaw(
	accessor: ArchiveAccessor,
	chunkSize = READ_CHUNK_SIZE,
): AsyncGenerator<ResourceStreamRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`streamAllResourcesRaw: chunkSize must be positive, got ${chunkSize}`,
		);
	}
	const knex = accessor.getKnex();

	let lastId = 0;
	for (;;) {
		const rows: {
			resourceId: number;
			url: string | null;
			status: number | null;
			statusText: string | null;
			contentType: string | null;
			contentLength: number | null;
			referrerCount: string | number | null;
		}[] = await knex('resource_items as ri')
			.leftJoin('url_refs as ur', 'ur.id', 'ri.url_id')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'ri.content_type_id')
			.where('ri.id', '>', lastId)
			.orderBy('ri.id', 'asc')
			.limit(chunkSize)
			.select(
				'ri.id as resourceId',
				'ur.url as url',
				'ri.status as status',
				'ri.status_text as statusText',
				'ctr.raw as contentType',
				'ri.content_length as contentLength',
				knex.raw(
					'coalesce((select sum("count") from "resource_ref_edges" where "resource_ref_edges"."resource_id" = "ri"."id"), 0) as "referrerCount"',
				),
			);

		if (rows.length === 0) {
			return;
		}
		lastId = rows.at(-1)!.resourceId;

		yield rows.map((row) => ({
			resourceId: row.resourceId,
			url: row.url,
			status: row.status,
			statusText: row.statusText,
			contentType: row.contentType,
			contentLength: row.contentLength,
			referrerCount: Number(row.referrerCount ?? 0),
		}));
	}
}
