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
 * Shares {@link listLinks}'s redirect-resolution pattern (`LEFT JOIN
 * canonical ON dest.redirectDestId = canonical.id`, `COALESCE(canonical.*,
 * dest.*)`) so a 301 intermediate never produces a destination distinct from
 * its final target — but where `listLinks` returns one row per anchor,
 * this groups by the resolved destination's page id (not URL, so redirect
 * chains that resolve to the same page always land in the same group
 * regardless of literal-URL casing/formatting differences) and reduces each
 * group to a single row. `referrerCount` is `COUNT(DISTINCT source.id)`,
 * not `COUNT(anchors.id)`: two `<a>` tags on the same page pointing at the
 * same destination must count as one referrer, not two.
 *
 * `listLinks` itself is intentionally untouched — CLI/MCP call it directly
 * (not through this function), and its anchor-level, non-deduplicated shape
 * is still the right one for `type: 'broken'` and for diagnostic tooling
 * that wants to see every individual anchor.
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options.
 * @returns A paginated list of unique external destinations.
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
	const destUrlExpression = 'COALESCE("canonical"."url", "dest"."url")';
	const statusExpression = 'COALESCE("canonical"."status", "dest"."status")';

	// Single source of truth for which sortBy values are valid, so the
	// URL-sort-temp-table guard below can never diverge from applyListOrder's
	// own column resolution (applyListOrder falls back to the first entry —
	// destUrl, a `type: 'url'` column — for any key it doesn't recognize, so
	// checking `sortBy === 'destUrl'` alone would miss that fallback and skip
	// preparing the temp table it silently ends up needing).
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

	const baseQuery = knex('anchors')
		.join('pages as source', 'anchors.pageId', '=', 'source.id')
		.join('pages as dest', 'anchors.hrefId', '=', 'dest.id')
		.leftJoin('pages as canonical', 'dest.redirectDestId', '=', 'canonical.id')
		.whereRaw(`COALESCE("canonical"."isExternal", "dest"."isExternal") = 1`);

	if (options.urlPattern) {
		baseQuery.whereRaw(`${destUrlExpression} like ?`, [options.urlPattern]);
	}
	if (options.status != null) {
		baseQuery.whereRaw(`${statusExpression} = ?`, [options.status]);
	}

	// Total must count distinct destinations, not anchors or GROUP BY rows —
	// wrap the grouped id list in a subquery so the outer COUNT(*) sees one
	// row per destination.
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
		await ensureUrlSortTempTable(accessor);
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
	// Tiebreaker: sorting by status/referrerCount alone is non-deterministic
	// whenever destinations tie (e.g. many ad domains all returning 200), which
	// would make MPA pagination duplicate or skip rows across pages. destId is
	// the GROUP BY key itself, so ordering by it is always well-defined and
	// gives every page a stable, unique row order.
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
