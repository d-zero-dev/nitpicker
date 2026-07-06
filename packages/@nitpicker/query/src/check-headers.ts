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
 * @param accessor - The archive accessor to query.
 * @param options - Filter and pagination options.
 * @param options.limit - Maximum number of results. Defaults to 100.
 * @param options.offset - Number of results to skip. Defaults to 0.
 * @param options.missingOnly - When true, only returns pages missing at least one security header.
 * @returns A paginated list of header check results.
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

	const baseQuery = knex('pages')
		.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
		.whereNull('redirectDestId');

	if (options.missingOnly) {
		baseQuery.where((qb) => {
			for (const key of HEADER_PRESENCE_KEYS) {
				qb.orWhereRaw(`${headerPresenceExpression(key)} = 0`);
			}
		});
	}
	for (const key of HEADER_PRESENCE_KEYS) {
		const expected = options[key];
		if (expected != null) {
			baseQuery.whereRaw(`${headerPresenceExpression(key)} = ?`, [expected ? 1 : 0]);
		}
	}

	const countResult = (await baseQuery.clone().count('id as total')) as {
		total: number;
	}[];
	// SQL count() always returns exactly one row
	const totalCount = countResult[0]?.total ?? 0;

	const dataQuery = baseQuery.clone().select('url', ...buildHeaderPresenceSelects(knex));
	applyListOrder(dataQuery, knex, sortBy, sortOrder, {
		url: { column: '"pages"."url"', type: useUrlSort ? 'url' : 'plain' },
		hasCSP: { column: headerPresenceExpression('hasCSP') },
		hasXFrameOptions: { column: headerPresenceExpression('hasXFrameOptions') },
		hasXContentTypeOptions: {
			column: headerPresenceExpression('hasXContentTypeOptions'),
		},
		hasHSTS: { column: headerPresenceExpression('hasHSTS') },
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
