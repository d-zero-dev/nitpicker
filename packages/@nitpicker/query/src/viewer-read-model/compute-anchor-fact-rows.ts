import type { AnchorFactInsertRow } from './types.js';
import type { Knex } from 'knex';

import { NULL_STATUS_SENTINEL } from './null-status-sentinel.js';

/**
 * Computes one row per unique `(source_page_id, dest_page_id)` pair for
 * bulk insert into `viewer_anchor_facts`, for `viewer_external_links` to
 * derive its summary from afterward (`deriveExternalLinkSummaryRows`) —
 * this is the only `anchors` scan the read-model build performs for either
 * table.
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
 * @returns One row per unique `(source_page_id, dest_page_id)` pair.
 */
export async function computeAnchorFactRows(trx: Knex): Promise<AnchorFactInsertRow[]> {
	const destIdExpression = 'COALESCE("canonical"."id", "dest"."id")';
	const destUrlExpression = 'COALESCE("canonical"."url", "dest"."url")';
	const statusExpression = 'COALESCE("canonical"."status", "dest"."status")';
	const isExternalExpression = 'COALESCE("canonical"."isExternal", "dest"."isExternal")';

	const rows: {
		sourcePageId: number;
		destPageId: number;
		sourceUrl: string;
		destUrl: string;
		status: number | null;
		isExternal: 0 | 1;
		count: number;
	}[] = await trx('anchors')
		.join('pages as source', 'anchors.pageId', '=', 'source.id')
		.join('pages as dest', 'anchors.hrefId', '=', 'dest.id')
		.leftJoin('pages as canonical', 'dest.redirectDestId', '=', 'canonical.id')
		.groupBy('source.id', trx.raw(destIdExpression))
		.select(
			'source.id as sourcePageId',
			trx.raw(`${destIdExpression} as "destPageId"`),
			'source.url as sourceUrl',
			trx.raw(`${destUrlExpression} as "destUrl"`),
			trx.raw(`${statusExpression} as "status"`),
			trx.raw(`${isExternalExpression} as "isExternal"`),
			trx.raw('count(*) as "count"'),
		);

	return rows.map((row) => {
		const statusSortKey = row.status ?? NULL_STATUS_SENTINEL;
		return {
			source_page_id: row.sourcePageId,
			dest_page_id: row.destPageId,
			source_url_sort_key: row.sourceUrl,
			dest_url_sort_key: row.destUrl,
			status: row.status,
			status_sort_key: statusSortKey,
			status_desc_key: -statusSortKey,
			count: Number(row.count),
			is_broken: row.status === 404 ? 1 : 0,
			is_external_link: row.isExternal ? 1 : 0,
		};
	});
}
