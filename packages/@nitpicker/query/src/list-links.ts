import type { LinkAnalysisResult, LinkEntry, ListLinksOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyListOrder } from './apply-list-order.js';

/**
 * Analyse links in the archive: **broken** (canonical destination resolved
 * to HTTP 404 Not Found) or **external** (anchors leaving the in-scope
 * hostname).
 *
 * 0.13: reads 0.13 `anchor_edges` (already deduped per
 * `(page_id, href_page_id)` pair with a per-pair `count`) instead of the
 * per-row legacy `anchors` table. The `items` array now contains one row
 * per unique `(source, dest)` pair — a page with N duplicate anchors to
 * the same destination collapses into a single row. The `total` count
 * still reports total anchor occurrences via `SUM(anchor_edges.count)` so
 * it matches the pre-0.13 `COUNT(anchors.id)` semantics. Anchor text
 * comes from `first_text_id` (0.13 preserves the first anchor's
 * text as the representative).
 *
 * `broken` is deliberately narrow. 403 Forbidden means the resource exists
 * but access is denied — not a broken link. 5xx and the `status = -1`
 * hard-failure sentinel are also excluded: they are transient/infra
 * concerns tracked separately (Errors view / `--retry-failed`), not
 * "this link goes nowhere". A destination that was never fetched has
 * `status IS NULL`, which never satisfies `= 404`, so excluded destinations
 * are never misreported as broken links.
 *
 * Anchor destinations are resolved through `content_items.redirect_dest_id`
 * to their canonical final destination before broken / external judgment.
 * When `includeRedirectSources: true`, the resolution is skipped and the
 * literal dest values are used.
 * @param accessor - The archive accessor to query.
 * @param options - Filter and pagination options.
 * @returns Link analysis results with entries and total count.
 */
export async function listLinks(
	accessor: ArchiveAccessor,
	options: ListLinksOptions,
): Promise<LinkAnalysisResult> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const includeRedirectSources = options.includeRedirectSources ?? false;
	const sortBy = options.sortBy ?? 'sourceUrl';
	const sortOrder = options.sortOrder ?? 'asc';
	const useUrlSort = options.sortBy != null;

	const baseQuery = knex('anchor_edges as ae')
		.join('content_items as source', 'ae.page_id', 'source.id')
		.join('content_items as dest', 'ae.href_page_id', 'dest.id')
		.join('url_refs as source_ur', 'source_ur.id', 'source.url_id')
		.join('url_refs as dest_ur', 'dest_ur.id', 'dest.url_id')
		.leftJoin('text_refs as text_ref', 'text_ref.id', 'ae.first_text_id');

	if (!includeRedirectSources) {
		baseQuery
			.leftJoin('content_items as canonical', 'dest.redirect_dest_id', 'canonical.id')
			.leftJoin('url_refs as canonical_ur', 'canonical_ur.id', 'canonical.url_id');
	}

	const destUrlExpression = includeRedirectSources
		? '"dest_ur"."url"'
		: 'COALESCE("canonical_ur"."url", "dest_ur"."url")';
	const statusExpression = includeRedirectSources
		? '"dest"."status"'
		: 'COALESCE("canonical"."status", "dest"."status")';
	const isExternalExpression = includeRedirectSources
		? '"dest"."is_external"'
		: 'COALESCE("canonical"."is_external", "dest"."is_external")';

	baseQuery.select(
		'source_ur.url as sourceUrl',
		knex.raw(`${destUrlExpression} as "destUrl"`),
		knex.raw(`${statusExpression} as "status"`),
		knex.raw(`${isExternalExpression} as "isExternal"`),
		'text_ref.text as textContent',
	);

	if (options.type === 'broken') {
		baseQuery.whereRaw(`${statusExpression} = 404`);
	} else {
		baseQuery.whereRaw(`${isExternalExpression} = 1`);
	}
	if (options.urlPattern) {
		const urlPattern = options.urlPattern;
		baseQuery.where((qb) => {
			qb.where('source_ur.url', 'like', urlPattern).orWhereRaw(
				`${destUrlExpression} like ?`,
				[urlPattern],
			);
		});
	}
	if (options.status != null) {
		baseQuery.whereRaw(`${statusExpression} = ?`, [options.status]);
	}

	const countResult = (await baseQuery
		.clone()
		.clearSelect()
		.sum('ae.count as total')) as { total: number | null }[];
	const total = countResult[0]?.total ?? 0;

	const dataQuery = baseQuery.clone();
	applyListOrder(dataQuery, knex, sortBy, sortOrder, {
		sourceUrl: { column: '"source_ur"."url"', type: useUrlSort ? 'url' : 'plain' },
		destUrl: {
			column: destUrlExpression,
			type: 'url',
		},
		status: {
			column: statusExpression,
		},
		isExternal: {
			column: isExternalExpression,
		},
		textContent: { column: '"text_ref"."text"' },
	});

	const rows = (await dataQuery.limit(limit).offset(offset)) as {
		sourceUrl: string;
		destUrl: string;
		status: number | null;
		isExternal: 0 | 1;
		textContent: string | null;
	}[];

	const items: LinkEntry[] = rows.map((row) => ({
		sourceUrl: row.sourceUrl,
		destUrl: row.destUrl,
		status: row.status,
		isExternal: !!row.isExternal,
		textContent: row.textContent,
	}));

	return {
		items,
		total: Number(total),
	};
}
