import type { HeaderCheckEntry, PaginatedHeaderCheckList } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

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
	options: {
		limit?: number;
		offset?: number;
		missingOnly?: boolean;
	} = {},
): Promise<PaginatedHeaderCheckList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	const baseQuery = knex('pages')
		.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
		.whereNull('redirectDestId');

	const countResult = (await baseQuery.clone().count('id as total')) as {
		total: number;
	}[];
	// SQL count() always returns exactly one row
	const totalCount = countResult[0]?.total ?? 0;

	const rows = await baseQuery
		.clone()
		.select('url', 'responseHeaders')
		.orderBy('url')
		.limit(limit)
		.offset(offset);

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

		if (
			options.missingOnly &&
			entry.hasCSP &&
			entry.hasXFrameOptions &&
			entry.hasXContentTypeOptions &&
			entry.hasHSTS
		) {
			continue;
		}

		items.push(entry);
	}

	return {
		items,
		total: Number(totalCount),
		offset,
		limit,
	};
}
