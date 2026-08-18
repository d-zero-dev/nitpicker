import type {
	ExternalLinkEntry,
	ListExternalLinksOptions,
	PaginatedExternalLinkList,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyListOrder } from './apply-list-order.js';
import { ensureUrlSortTempTable } from './url-sort-temp-table.js';

/**
 * Lists unique external destinations reached from the site, deduplicated by
 * canonical (redirect-resolved) target, with a per-destination referrer
 * count.
 *
 * 0.13: reads 0.13 `anchor_edges` joined to `content_items` and
 * `url_refs`. `referrerCount` uses `COUNT(DISTINCT source.id)` — unique
 * referrer pages, not anchor rows (`anchor_edges` already deduplicates
 * the `(page_id, href_page_id)` pair).
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options.
 * @returns A paginated list of unique external destinations.
 * @example
 * const { items, total } = await listExternalLinks(accessor, {
 *   sortBy: 'referrerCount',
 *   sortOrder: 'desc',
 *   limit: 20,
 * });
 * // items[0] is the external destination linked from the most pages.
 */
export async function listExternalLinks(
	accessor: ArchiveAccessor,
	options: ListExternalLinksOptions = {},
): Promise<PaginatedExternalLinkList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const sortOrder = options.sortOrder ?? 'asc';

	const destIdExpression = 'COALESCE("canonical"."id", "dest"."id")';
	const destUrlExpression = 'COALESCE("canonical_ur"."url", "dest_ur"."url")';
	const statusExpression = 'COALESCE("canonical"."status", "dest"."status")';

	const sortColumns: Record<
		'destUrl' | 'status' | 'referrerCount',
		{ column: string; type?: 'url' }
	> = {
		destUrl: { column: destUrlExpression, type: 'url' },
		status: { column: statusExpression },
		referrerCount: { column: '"referrerCount"' },
	};
	const sortBy =
		options.sortBy && options.sortBy in sortColumns ? options.sortBy : 'destUrl';

	const baseQuery = knex('anchor_edges as ae')
		.join('content_items as source', 'ae.page_id', 'source.id')
		.join('content_items as dest', 'ae.href_page_id', 'dest.id')
		.join('url_refs as dest_ur', 'dest_ur.id', 'dest.url_id')
		.leftJoin('content_items as canonical', 'dest.redirect_dest_id', 'canonical.id')
		.leftJoin('url_refs as canonical_ur', 'canonical_ur.id', 'canonical.url_id')
		.whereRaw(`COALESCE("canonical"."is_external", "dest"."is_external") = 1`);

	if (options.urlPattern) {
		baseQuery.whereRaw(`${destUrlExpression} like ?`, [options.urlPattern]);
	}
	if (options.status != null) {
		baseQuery.whereRaw(`${statusExpression} = ?`, [options.status]);
	}

	const groupedIds = baseQuery
		.clone()
		.clearSelect()
		.select(knex.raw(`${destIdExpression} as "destId"`))
		.groupBy(knex.raw(destIdExpression));
	const countResult = (await knex
		.count('* as total')
		.from(groupedIds.as('grouped_destinations'))) as { total: number }[];
	const total = Number(countResult[0]?.total ?? 0);

	if (sortColumns[sortBy].type === 'url') {
		await ensureUrlSortTempTable(accessor, options.onSortProgress);
	}

	const dataQuery = baseQuery
		.clone()
		.select(
			knex.raw(`${destUrlExpression} as "destUrl"`),
			knex.raw(`${statusExpression} as "status"`),
			knex.raw('count(distinct "source"."id") as "referrerCount"'),
		)
		.groupBy(knex.raw(destIdExpression));

	applyListOrder(dataQuery, knex, sortBy, sortOrder, sortColumns);
	dataQuery.orderByRaw(`${destIdExpression} asc`);

	const rows = (await dataQuery.limit(limit).offset(offset)) as {
		destUrl: string;
		status: number | null;
		referrerCount: number;
	}[];

	const items: ExternalLinkEntry[] = rows.map((row) => ({
		destUrl: row.destUrl,
		status: row.status,
		referrerCount: Number(row.referrerCount),
	}));

	return { items, total, offset, limit };
}
