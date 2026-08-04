import type { HeaderChecksEffectiveSortBy, HeaderChecksSortSpec } from './types.js';

import { HEADER_FLAG_COLUMN } from '../header-presence-sql.js';

/**
 * Resolves the keyset sort plan for `viewer_header_checks` from the
 * effective sort (see {@link HeaderChecksEffectiveSortBy} for the
 * `'urlBinary'` vs `'urlNatural'` split). Every tuple ends in `page_id`,
 * the stable tie-breaker — for the boolean header-flag sorts it also
 * disambiguates the (large) runs of equal-flag rows.
 * @param sortBy - The effective sort field.
 * @param sortOrder - The sort direction.
 * @returns The resolved {@link HeaderChecksSortSpec}.
 */
export function getHeaderChecksSortSpec(
	sortBy: HeaderChecksEffectiveSortBy,
	sortOrder: 'asc' | 'desc',
): HeaderChecksSortSpec {
	switch (sortBy) {
		case 'urlBinary': {
			return { columns: ['url_sort_key', 'page_id'], scanDirection: sortOrder };
		}
		case 'urlNatural': {
			return { columns: ['natural_url_rank', 'page_id'], scanDirection: sortOrder };
		}
		default: {
			// viewer_header_checks copies header_flags' snake column names
			// verbatim, so the shared HEADER_FLAG_COLUMN mapping resolves the
			// per-flag sort columns here too.
			return {
				columns: [HEADER_FLAG_COLUMN[sortBy], 'page_id'],
				scanDirection: sortOrder,
			};
		}
	}
}
