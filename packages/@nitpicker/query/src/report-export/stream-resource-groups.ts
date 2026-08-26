import type { ResourceGroupStreamRow } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/** `viewer_resource_groups` rows read per keyset chunk, by default. */
const READ_CHUNK_SIZE = 5000;

/**
 * Streams every `viewer_resource_groups` row for the Resources report
 * sheet's dedupe mode.
 *
 * Plain `group_id` keyset pagination (`group_id > lastId`). `group_id` is
 * assigned at build time (`computeResourceGroupRows`) in natural-URL-sorted
 * order, so streaming by `group_id` ascending reproduces that order without
 * a text sort key or a report-time sort pass — the aggregation itself
 * (grouping millions of raw resources into canonical groups) already
 * happened once in `buildViewerReadModel`, not on this call.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current before calling this
 *   — it assumes `viewer_resource_groups` exists and trusts its content.
 * @param chunkSize - `viewer_resource_groups` rows read per chunk. Must be positive.
 * @yields One chunk's rows, in `group_id` order.
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * for await (const chunk of streamResourceGroups(accessor)) {
 *   for (const group of chunk) {
 *     sheet.appendRow(toResourceGroupRow(group));
 *   }
 * }
 */
export async function* streamResourceGroups(
	accessor: ArchiveAccessor,
	chunkSize = READ_CHUNK_SIZE,
): AsyncGenerator<ResourceGroupStreamRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`streamResourceGroups: chunkSize must be positive, got ${chunkSize}`,
		);
	}
	const knex = accessor.getKnex();

	let lastId = 0;
	for (;;) {
		const rows: {
			groupId: number;
			canonicalUrl: string;
			status: number | null;
			statusText: string | null;
			contentType: string | null;
			contentLengthMin: number | null;
			contentLengthMax: number | null;
			count: number;
			referrerCount: number;
			referrerNote: string | null;
			queryPattern: string | null;
		}[] = await knex('viewer_resource_groups')
			.where('group_id', '>', lastId)
			.orderBy('group_id', 'asc')
			.limit(chunkSize)
			.select(
				'group_id as groupId',
				'canonical_url as canonicalUrl',
				'status as status',
				'status_text as statusText',
				'content_type as contentType',
				'content_length_min as contentLengthMin',
				'content_length_max as contentLengthMax',
				'count as count',
				'referrer_count as referrerCount',
				'referrer_note as referrerNote',
				'query_pattern as queryPattern',
			);

		if (rows.length === 0) {
			return;
		}
		lastId = rows.at(-1)!.groupId;

		yield rows.map((row) => ({
			canonicalUrl: row.canonicalUrl,
			status: row.status,
			statusText: row.statusText,
			contentType: row.contentType,
			contentLengthMin: row.contentLengthMin,
			contentLengthMax: row.contentLengthMax,
			count: row.count,
			referrerCount: row.referrerCount,
			referrerNote: row.referrerNote,
			queryPattern: row.queryPattern,
		}));
	}
}
