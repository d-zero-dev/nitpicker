import type { LinkAnalysisResult, LinkEntry, ListLinksOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyListOrder } from './apply-list-order.js';

/**
 * Analyse links in the archive: **broken** (4xx/5xx or no status) or
 * **external** (anchors leaving the in-scope hostname).
 *
 * Anchor destinations are resolved through `pages.redirectDestId` to their
 * canonical final destination before broken / external judgment. The
 * `redirectDestId` column is pre-flattened by the crawler to the final hop
 * (see `Database` comments in `@nitpicker/crawler/src/archive/database.ts`),
 * so a single `LEFT JOIN canonical ON dest.redirectDestId = canonical.id`
 * is sufficient — no SQL recursive CTE / chain walking needed. The
 * displayed `destUrl` / `status` / `isExternal` reflect the canonical row
 * via `COALESCE(canonical.*, dest.*)` so the user sees "this anchor
 * actually leads to <final URL with status N>" rather than the 301
 * intermediate.
 *
 * When `includeRedirectSources: true`, the resolution is skipped: anchors
 * report their **literal** target (dest as recorded), so a 301 intermediate
 * shows up as itself rather than its destination. Useful for diagnostic
 * "where do we still have redirect chains in our anchors?" audits; the
 * default case (`false`) is what end-user link-health reports want.
 *
 * `type: 'orphaned'` was removed in favour of
 * {@link import('./list-isolated-pages.js').listIsolatedPages}
 * (完全孤立 / singletons) and
 * {@link import('./list-isolated-clusters.js').listIsolatedClusters}
 * (孤立集合 / clusters) — two well-separated concepts that the old
 * single-bucket `'orphaned'` filter conflated.
 *
 * **Performance note.** On a 428k-row archive this query is anchor-scan-
 * bound: ~13-16s per page click, dominated by `SCAN anchors → rowid seek
 * source / dest / canonical`. The `idx_pages_listfilter` (PR #96) heuristic
 * keeps the planner on this fast path; switching to source/dest seeks via
 * the listfilter index would balloon the query to ~500s (33x worse — see
 * `idx_pages_listfilter` JSDoc). No JS push-down is possible (the JS side
 * only does `!!row.isExternal` casts), and the SQL `COALESCE` for redirect
 * canonical resolution cannot be denormalised without a `canonicalId`
 * column on pages (schema change, deferred). The current cost is accepted.
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

	// `COALESCE` resolves `dest.redirectDestId → canonical` so the reported
	// dest URL / status / isExternal reflect the final canonical destination
	// when one exists. When `includeRedirectSources` is true, the canonical
	// join is skipped and the literal dest values are used — exposing the
	// 301 intermediates and any anchors whose recorded target is itself a
	// redirect-source row.
	const baseQuery = knex('anchors')
		.join('pages as source', 'anchors.pageId', '=', 'source.id')
		.join('pages as dest', 'anchors.hrefId', '=', 'dest.id');

	if (!includeRedirectSources) {
		baseQuery.leftJoin('pages as canonical', 'dest.redirectDestId', '=', 'canonical.id');
	}

	const destUrlCol = includeRedirectSources
		? knex.raw('"dest"."url" as "destUrl"')
		: knex.raw('COALESCE("canonical"."url", "dest"."url") as "destUrl"');
	const statusCol = includeRedirectSources
		? knex.raw('"dest"."status" as "status"')
		: knex.raw('COALESCE("canonical"."status", "dest"."status") as "status"');
	const isExternalCol = includeRedirectSources
		? knex.raw('"dest"."isExternal" as "isExternal"')
		: knex.raw('COALESCE("canonical"."isExternal", "dest"."isExternal") as "isExternal"');
	const destUrlExpression = includeRedirectSources
		? '"dest"."url"'
		: 'COALESCE("canonical"."url", "dest"."url")';

	baseQuery.select(
		'source.url as sourceUrl',
		destUrlCol,
		statusCol,
		isExternalCol,
		'anchors.textContent',
	);

	if (options.type === 'broken') {
		// `status` here is the COALESCE-ed expression — broken judgment runs
		// against the canonical destination's status, not the 301 intermediate's.
		const brokenCondition = includeRedirectSources
			? `"dest"."status" >= 400 OR "dest"."status" IS NULL`
			: `COALESCE("canonical"."status", "dest"."status") >= 400 OR COALESCE("canonical"."status", "dest"."status") IS NULL`;
		baseQuery.whereRaw(brokenCondition);
	} else {
		const externalCondition = includeRedirectSources
			? `"dest"."isExternal" = 1`
			: `COALESCE("canonical"."isExternal", "dest"."isExternal") = 1`;
		baseQuery.whereRaw(externalCondition);
	}
	if (options.urlPattern) {
		const urlPattern = options.urlPattern;
		baseQuery.where((qb) => {
			qb.where('source.url', 'like', urlPattern).orWhereRaw(
				`${destUrlExpression} like ?`,
				[urlPattern],
			);
		});
	}

	const countResult = (await baseQuery
		.clone()
		.clearSelect()
		.count('anchors.id as total')) as { total: number }[];
	const total = countResult[0]?.total ?? 0;

	const dataQuery = baseQuery.clone();
	applyListOrder(dataQuery, knex, sortBy, sortOrder, {
		sourceUrl: { column: '"source"."url"', type: useUrlSort ? 'url' : 'plain' },
		destUrl: {
			column: destUrlExpression,
			type: 'url',
		},
		status: {
			column: includeRedirectSources
				? '"dest"."status"'
				: 'COALESCE("canonical"."status", "dest"."status")',
		},
		isExternal: {
			column: includeRedirectSources
				? '"dest"."isExternal"'
				: 'COALESCE("canonical"."isExternal", "dest"."isExternal")',
		},
		textContent: { column: '"anchors"."textContent"' },
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
