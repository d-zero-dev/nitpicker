import type { ResourceReferrerEdgeStreamRow } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/** `resource_ref_edges` rows read per keyset chunk, by default. */
const READ_CHUNK_SIZE = 20_000;

/**
 * Streams every `(resource, referring page)` pair for the Resources
 * Relational Table report sheet.
 *
 * `resource_ref_edges` is `WITHOUT ROWID` with a composite primary key
 * `(resource_id, page_id)` and no surrogate integer id, so this cannot use
 * plain `id`-column keyset pagination the way `streamAllResourcesRaw` and
 * `streamAnchorFactEdges` do. Instead it walks the composite primary key
 * directly with a row-value tuple comparison
 * (`WHERE (resource_id, page_id) > (?, ?)`), which SQLite evaluates
 * efficiently against a `WITHOUT ROWID` table's PK-ordered physical
 * clustering — the same key range the table is already stored in, so this
 * is not a fallback-to-scan path.
 *
 * `resource_ref_edges.count` is always `1` for every row (0.13's write path
 * `ON CONFLICT ... IGNORE`s a repeat observation of the same pair rather
 * than incrementing a counter — see `insertResourceReferrers`'s docs), so
 * unlike `viewer_anchor_facts` there is no collapsed-occurrence count to
 * expose here: this table is already at its finest grain.
 * @param accessor - The archive accessor to query.
 * @param chunkSize - Rows read per chunk. Must be positive.
 * @yields One chunk's rows, in `(resource_id, page_id)` order.
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * for await (const chunk of streamResourceReferrerEdges(accessor)) {
 *   for (const row of chunk) {
 *     sheet.appendRow(toResourcesRelationalRow(row));
 *   }
 * }
 */
export async function* streamResourceReferrerEdges(
	accessor: ArchiveAccessor,
	chunkSize = READ_CHUNK_SIZE,
): AsyncGenerator<ResourceReferrerEdgeStreamRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`streamResourceReferrerEdges: chunkSize must be positive, got ${chunkSize}`,
		);
	}
	const knex = accessor.getKnex();

	let cursor: { resourceId: number; pageId: number } | null = null;
	for (;;) {
		let query = knex('resource_ref_edges as rre')
			.join('content_items as ci', 'ci.id', 'rre.page_id')
			.join('url_refs as page_ur', 'page_ur.id', 'ci.url_id')
			.leftJoin('resource_items as ri', 'ri.id', 'rre.resource_id')
			.leftJoin('url_refs as resource_ur', 'resource_ur.id', 'ri.url_id')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'ri.content_type_id');
		if (cursor) {
			query = query.where((qb) => {
				qb.where('rre.resource_id', '>', cursor!.resourceId).orWhere((qb2) => {
					qb2
						.where('rre.resource_id', cursor!.resourceId)
						.andWhere('rre.page_id', '>', cursor!.pageId);
				});
			});
		}
		const rows: {
			resourceId: number;
			pageId: number;
			pageUrl: string;
			resourceUrl: string | null;
			status: number | null;
			statusText: string | null;
			contentType: string | null;
			contentLength: number | null;
		}[] = await query
			.orderBy([
				{ column: 'rre.resource_id', order: 'asc' },
				{ column: 'rre.page_id', order: 'asc' },
			])
			.limit(chunkSize)
			.select(
				'rre.resource_id as resourceId',
				'rre.page_id as pageId',
				'page_ur.url as pageUrl',
				'resource_ur.url as resourceUrl',
				'ri.status as status',
				'ri.status_text as statusText',
				'ctr.raw as contentType',
				'ri.content_length as contentLength',
			);

		if (rows.length === 0) {
			return;
		}
		const last = rows.at(-1)!;
		cursor = { resourceId: last.resourceId, pageId: last.pageId };

		yield rows.map((row) => ({
			pageUrl: row.pageUrl,
			resourceUrl: row.resourceUrl,
			status: row.status,
			statusText: row.statusText,
			contentType: row.contentType,
			contentLength: row.contentLength,
		}));
	}
}
