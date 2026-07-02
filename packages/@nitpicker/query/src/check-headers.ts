import type { HeaderCheckEntry, PaginatedHeaderCheckList } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyListOrder } from './apply-list-order.js';

type HeaderPresenceKey =
	| 'hasCSP'
	| 'hasXFrameOptions'
	| 'hasXContentTypeOptions'
	| 'hasHSTS';

type CheckHeadersOptions = {
	limit?: number;
	offset?: number;
	missingOnly?: boolean;
	hasCSP?: boolean;
	hasXFrameOptions?: boolean;
	hasXContentTypeOptions?: boolean;
	hasHSTS?: boolean;
	sortBy?: 'url' | HeaderPresenceKey;
	sortOrder?: 'asc' | 'desc';
};

const HEADER_PATTERNS: Record<HeaderPresenceKey, string> = {
	hasCSP: '%content-security-policy%',
	hasXFrameOptions: '%x-frame-options%',
	hasXContentTypeOptions: '%x-content-type-options%',
	hasHSTS: '%strict-transport-security%',
};

/**
 * Builds the SQL boolean expression used for paging before JSON parsing.
 * @param key - Header presence field to evaluate.
 */
function headerPresenceExpression(key: HeaderPresenceKey): string {
	return `case when lower(coalesce("pages"."responseHeaders", '')) like '${HEADER_PATTERNS[key]}' then 1 else 0 end`;
}

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
			for (const key of Object.keys(HEADER_PATTERNS) as HeaderPresenceKey[]) {
				qb.orWhereRaw(`${headerPresenceExpression(key)} = 0`);
			}
		});
	}
	for (const key of Object.keys(HEADER_PATTERNS) as HeaderPresenceKey[]) {
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

	const dataQuery = baseQuery.clone().select('url', 'responseHeaders');
	applyListOrder(dataQuery, knex, sortBy, sortOrder, {
		url: { column: '"pages"."url"', type: useUrlSort ? 'url' : 'plain' },
		hasCSP: { column: headerPresenceExpression('hasCSP') },
		hasXFrameOptions: { column: headerPresenceExpression('hasXFrameOptions') },
		hasXContentTypeOptions: {
			column: headerPresenceExpression('hasXContentTypeOptions'),
		},
		hasHSTS: { column: headerPresenceExpression('hasHSTS') },
	});
	const rows = await dataQuery.limit(limit).offset(offset);

	const items: HeaderCheckEntry[] = [];

	for (const row of rows) {
		let headers: Record<string, string> = {};
		try {
			if (row.responseHeaders) {
				headers = JSON.parse(row.responseHeaders);
			}
		} catch (error) {
			console.warn(`Failed to parse responseHeaders for ${row.url}:`, error);
		}

		const lowerHeaders = Object.fromEntries(
			Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
		);

		const entry: HeaderCheckEntry = {
			url: row.url,
			hasCSP: 'content-security-policy' in lowerHeaders,
			hasXFrameOptions: 'x-frame-options' in lowerHeaders,
			hasXContentTypeOptions: 'x-content-type-options' in lowerHeaders,
			hasHSTS: 'strict-transport-security' in lowerHeaders,
		};

		items.push(entry);
	}

	return {
		items,
		total: Number(totalCount),
		offset,
		limit,
	};
}
