import type { AnchorFactInsertRow } from './types.js';
import type { Knex } from 'knex';

import { NULL_STATUS_SENTINEL } from './null-status-sentinel.js';

/**
 * Span of `source.id` (`pages.id`) values scanned per `anchors` chunk, by
 * default. Unlike `computeResourceInsertRows`'s `chunkSize` (a row count),
 * this is an id-range width — see this function's docs for why.
 */
const READ_CHUNK_SIZE = 2000;

/**
 * Computes one row per unique `(source_page_id, dest_page_id)` pair for
 * bulk insert into `viewer_anchor_facts`, for `viewer_external_links` to
 * derive its summary from afterward (`deriveExternalLinkSummaryRows`) —
 * this is the only `anchors` scan the read-model build performs for either
 * table.
 *
 * Reads `anchors` in bounded chunks instead of one unbounded `SELECT`, by
 * partitioning `source.id` into non-overlapping ranges
 * (`WHERE source.id > :start AND source.id <= :end`) and running the
 * unmodified `GROUP BY`/aggregation once per range — NOT by paginating the
 * aggregated output with `ORDER BY source.id LIMIT :n` the way
 * `computeResourceInsertRows`/`readUrlChunks` do. The `GROUP BY` key here is
 * the compound `(source.id, destId)`, and a single `source.id` can
 * legitimately produce several output rows (one page can link to many
 * distinct destinations); a `LIMIT` on the aggregated output could stop
 * mid-way through one `source.id`'s groups, and the next chunk's strict
 * `source.id > lastId` cursor would then silently skip that `source.id`'s
 * remaining groups. Filtering on `source.id` itself — the group key's first
 * column — is all-or-nothing per `source.id`, so a group can never straddle
 * two ranges. An empty range is not a stop condition (unlike
 * `computeResourceInsertRows`'s empty-chunk-means-done): a `source.id` range
 * with zero anchors is unremarkable and must not truncate the scan, so the
 * loop instead runs until `rangeStart` passes `pages`'s max id.
 *
 * Redirect resolution (`COALESCE(canonical.*, dest.*)`) and the broken-link
 * definition (`status = 404` strictly — see `list-links.ts`'s scope note:
 * 403/5xx/unknown never count as broken) are lifted verbatim from
 * `list-links.ts`/`list-external-links.ts`'s live queries. Duplicate
 * anchors between the same pair (e.g. a nav link repeated in header and
 * footer) collapse into one row via `count` — see
 * ARCHITECTURE.md「設計注意（viewer_anchor_facts read model、issue
 * #114）」for why this is a genuine read/write/storage improvement, not
 * just a shortcut.
 * @param trx - An open Knex transaction (a plain `Knex` instance also
 *   works, e.g. in tests).
 * @param chunkSize - Width of the `source.id` range scanned per chunk. Must
 *   be positive — a non-positive value would leave `rangeStart` unable to
 *   ever reach `pages`'s max id, hanging the generator forever instead of
 *   completing or throwing. Defaults to {@link READ_CHUNK_SIZE}; overridable
 *   for tests that need to exercise chunk boundaries against a small
 *   fixture. Peak memory per chunk scales with `chunkSize × average
 *   distinct destinations per page`, not `chunkSize` alone — re-check this
 *   default against a real large-archive run if a chunk's row count turns
 *   out unexpectedly large.
 * @yields {AnchorFactInsertRow[]} One `source.id` range's rows, one per
 *   unique `(source_page_id, dest_page_id)` pair in that range.
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * for await (const chunk of computeAnchorFactRows(trx)) {
 *   await trx('viewer_anchor_facts').insert(chunk);
 * }
 */
export async function* computeAnchorFactRows(
	trx: Knex,
	chunkSize = READ_CHUNK_SIZE,
): AsyncGenerator<AnchorFactInsertRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`computeAnchorFactRows: chunkSize must be positive, got ${chunkSize}`,
		);
	}

	const destIdExpression = 'COALESCE("canonical"."id", "dest"."id")';
	const statusExpression = 'COALESCE("canonical"."status", "dest"."status")';
	const isExternalExpression = 'COALESCE("canonical"."isExternal", "dest"."isExternal")';

	const maxIdRows = (await trx('pages').max('id as maxId')) as { maxId: number | null }[];
	const maxId = maxIdRows[0]?.maxId ?? 0;

	for (let rangeStart = 0; rangeStart < maxId; rangeStart += chunkSize) {
		const rangeEnd = rangeStart + chunkSize;

		const rows: {
			sourcePageId: number;
			destPageId: number;
			sourceUrlRefId: number | null;
			destUrlRefId: number | null;
			status: number | null;
			isExternal: 0 | 1;
			count: number;
		}[] = await trx('anchors')
			.join('pages as source', 'anchors.pageId', '=', 'source.id')
			.join('pages as dest', 'anchors.hrefId', '=', 'dest.id')
			.leftJoin('pages as canonical', 'dest.redirectDestId', '=', 'canonical.id')
			.leftJoin('viewer_url_refs as source_ref', 'source.url', '=', 'source_ref.url')
			.leftJoin('viewer_url_refs as dest_ref', function () {
				this.on(trx.raw('"dest_ref"."url" = COALESCE("canonical"."url", "dest"."url")'));
			})
			.where('source.id', '>', rangeStart)
			.andWhere('source.id', '<=', rangeEnd)
			.groupBy('source.id', trx.raw(destIdExpression))
			.select(
				'source.id as sourcePageId',
				trx.raw(`${destIdExpression} as "destPageId"`),
				'source_ref.id as sourceUrlRefId',
				'dest_ref.id as destUrlRefId',
				trx.raw(`${statusExpression} as "status"`),
				trx.raw(`${isExternalExpression} as "isExternal"`),
				trx.raw('count(*) as "count"'),
			);

		if (rows.length === 0) {
			continue;
		}

		yield rows.map((row) => {
			const statusSortKey = row.status ?? NULL_STATUS_SENTINEL;
			if (row.sourceUrlRefId == null || row.destUrlRefId == null) {
				throw new Error(
					`computeAnchorFactRows: missing viewer_url_refs entry for source=${row.sourcePageId}, dest=${row.destPageId}`,
				);
			}
			return {
				source_page_id: row.sourcePageId,
				dest_page_id: row.destPageId,
				source_url_ref_id: row.sourceUrlRefId,
				dest_url_ref_id: row.destUrlRefId,
				status: row.status,
				status_sort_key: statusSortKey,
				status_desc_key: -statusSortKey,
				count: Number(row.count),
				is_broken: row.status === 404 ? 1 : 0,
				is_external_link: row.isExternal ? 1 : 0,
			};
		});
	}
}
