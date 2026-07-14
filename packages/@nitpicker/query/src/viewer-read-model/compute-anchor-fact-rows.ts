import type { AnchorFactInsertRow } from './types.js';
import type { Knex } from 'knex';

import { NULL_STATUS_SENTINEL } from './null-status-sentinel.js';

/**
 * Span of `source.id` (`content_items.id`) values scanned per
 * `anchor_edges` chunk, by default. Unlike `computeResourceInsertRows`'s
 * `chunkSize` (a row count), this is an id-range width — see this
 * function's docs for why.
 */
const READ_CHUNK_SIZE = 2000;

/**
 * Computes one row per unique `(source_page_id, dest_page_id)` pair for
 * bulk insert into `viewer_anchor_facts`, for `viewer_external_links` to
 * derive its summary from afterward (`deriveExternalLinkSummaryRows`) —
 * this is the only `anchor_edges` scan the read-model build performs for
 * either table.
 *
 * Phase 6-F: reads Phase 6-C `anchor_edges` (already deduped to distinct
 * `(page_id, href_page_id)` with a per-pair `count` column) instead of the
 * per-row `anchors` legacy table, and resolves URLs through
 * `url_refs` (`content_items.url_id`). Because `anchor_edges` is already
 * grouped per `(page_id, href_page_id)`, the count is `SUM(ae.count)`
 * across the resolved-canonical destinations (multiple distinct dest pages
 * that redirect to the same canonical still collapse in the output row and
 * their counts must add — this preserves the pre-Phase-6 semantics where
 * `count(*)` on the per-row `anchors` table produced the summed occurrence
 * count).
 *
 * Reads `anchor_edges` in bounded chunks by partitioning `source.id`
 * (`content_items.id`) into non-overlapping ranges
 * (`WHERE source.id > :start AND source.id <= :end`) and running the
 * unmodified `GROUP BY`/aggregation once per range — NOT by paginating the
 * aggregated output with `LIMIT`. The `GROUP BY` key here is the compound
 * `(source.id, resolved dest id)`; a single `source.id` can legitimately
 * produce several output rows (one page can link to many distinct
 * destinations), and a `LIMIT` on the aggregated output could stop mid-way
 * through one `source.id`'s groups and silently skip the rest. Filtering
 * on `source.id` itself is all-or-nothing per source page, so a group can
 * never straddle two ranges. An empty range is not a stop condition (a
 * `source.id` range with zero anchor_edges is unremarkable); the loop
 * instead runs until `rangeStart` passes `content_items`'s max id.
 *
 * Redirect resolution (`COALESCE(canonical.*, dest.*)`) and the
 * broken-link definition (`status = 404` strictly — see `list-links.ts`'s
 * scope note) are preserved verbatim.
 * @param trx - An open Knex transaction (a plain `Knex` instance also
 *   works, e.g. in tests).
 * @param chunkSize - Width of the `source.id` range scanned per chunk. Must
 *   be positive.
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
	const isExternalExpression =
		'COALESCE("canonical"."is_external", "dest"."is_external")';
	const destUrlExpression = 'COALESCE("canonical_url"."url", "dest_url"."url")';

	const maxIdRows = (await trx('content_items').max('id as maxId')) as {
		maxId: number | null;
	}[];
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
		}[] = await trx('anchor_edges as ae')
			.join('content_items as source', 'ae.page_id', '=', 'source.id')
			.join('content_items as dest', 'ae.href_page_id', '=', 'dest.id')
			.leftJoin(
				'content_items as canonical',
				'dest.redirect_dest_id',
				'=',
				'canonical.id',
			)
			.join('url_refs as source_url', 'source.url_id', '=', 'source_url.id')
			.join('url_refs as dest_url', 'dest.url_id', '=', 'dest_url.id')
			.leftJoin('url_refs as canonical_url', 'canonical.url_id', '=', 'canonical_url.id')
			.leftJoin('viewer_url_refs as source_ref', 'source_url.url', '=', 'source_ref.url')
			.leftJoin('viewer_url_refs as dest_ref', function () {
				this.on(trx.raw(`"dest_ref"."url" = ${destUrlExpression}`));
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
				trx.raw('sum("ae"."count") as "count"'),
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
