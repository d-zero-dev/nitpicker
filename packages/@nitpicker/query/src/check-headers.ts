import type {
	CheckHeadersOptions,
	HeaderCheckEntry,
	HeaderPresenceKey,
	PaginatedHeaderCheckList,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyListOrder } from './apply-list-order.js';
import { buildHeaderPresenceSelects } from './build-header-presence-selects.js';
import { HEADER_PRESENCE_KEYS, headerPresenceExpression } from './header-presence-sql.js';

/**
 * Checks security-related HTTP response headers for internal pages.
 * Inspects Content-Security-Policy, X-Frame-Options, X-Content-Type-Options,
 * and Strict-Transport-Security headers.
 *
 * 0.13: reads through the 0.13 `content_items` entity table +
 * 0.13 `header_flags` pre-computed booleans instead of scanning
 * `pages.responseHeaders` with a LIKE predicate. `header_flags` may be
 * missing for pages with no captured headers — the LEFT JOIN +
 * `coalesce(..., 0)` in {@link headerPresenceExpression} preserves the
 * pre-0.13 "no headers → not present" behaviour.
 * @param accessor - The archive accessor to query.
 * @param options - Filter and pagination options.
 * @param options.limit - Maximum number of results. Defaults to 100.
 * @param options.offset - Number of results to skip. Defaults to 0.
 * @param options.missingOnly - When true, only returns pages missing at least one security header.
 * @returns A paginated list of header check results.
 * @example
 * const { items, total } = await checkHeaders(accessor, { missingOnly: true, limit: 50 });
 * for (const page of items) {
 *   if (!page.hasCSP) console.log(`${page.url} has no Content-Security-Policy`);
 * }
 */
export async function checkHeaders(
	accessor: ArchiveAccessor,
	options: CheckHeadersOptions = {},
): Promise<PaginatedHeaderCheckList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const sortBy = options.sortBy ?? 'url';
	const sortOrder = options.sortOrder ?? 'asc';
	const useUrlSort = options.sortBy != null;

	const baseQuery = knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
		.leftJoin('header_flags as hf', 'hf.header_set_id', 'ci.header_set_id')
		.where({ 'ci.scraped': 1, 'ci.is_external': 0, 'ctr.raw': 'text/html' })
		.whereNull('ci.redirect_dest_id');

	if (options.missingOnly) {
		baseQuery.where((qb) => {
			for (const key of HEADER_PRESENCE_KEYS) {
				qb.orWhereRaw(`${headerPresenceExpression(key, 'hf')} = 0`);
			}
		});
	}
	for (const key of HEADER_PRESENCE_KEYS) {
		const expected = options[key];
		if (expected != null) {
			baseQuery.whereRaw(`${headerPresenceExpression(key, 'hf')} = ?`, [
				expected ? 1 : 0,
			]);
		}
	}

	const countResult = (await baseQuery.clone().count('ci.id as total')) as {
		total: number;
	}[];
	const totalCount = countResult[0]?.total ?? 0;

	const dataQuery = baseQuery
		.clone()
		.select('ur.url as url', ...buildHeaderPresenceSelects(knex, 'hf'));
	applyListOrder(dataQuery, knex, sortBy, sortOrder, {
		url: { column: '"ur"."url"', type: useUrlSort ? 'url' : 'plain' },
		hasCSP: { column: headerPresenceExpression('hasCSP', 'hf') },
		hasXFrameOptions: { column: headerPresenceExpression('hasXFrameOptions', 'hf') },
		hasXContentTypeOptions: {
			column: headerPresenceExpression('hasXContentTypeOptions', 'hf'),
		},
		hasHSTS: { column: headerPresenceExpression('hasHSTS', 'hf') },
	});
	const rows = (await dataQuery.limit(limit).offset(offset)) as (Record<
		HeaderPresenceKey,
		0 | 1
	> & { url: string })[];

	const items: HeaderCheckEntry[] = rows.map((row) => ({
		url: row.url,
		hasCSP: !!row.hasCSP,
		hasXFrameOptions: !!row.hasXFrameOptions,
		hasXContentTypeOptions: !!row.hasXContentTypeOptions,
		hasHSTS: !!row.hasHSTS,
	}));

	return {
		items,
		total: Number(totalCount),
		offset,
		limit,
	};
}
