import type { HeaderPresence, HeaderPresenceKey } from '../types.js';
import type { Knex } from 'knex';

import { buildHeaderPresenceSelects } from '../build-header-presence-selects.js';
import { HEADER_PRESENCE_KEYS } from '../header-presence-sql.js';

/** One row read from `pages`, projected to just the columns this computation needs. */
type HeaderCheckSourceRow = Record<HeaderPresenceKey, 0 | 1> & {
	/** `pages.id` — becomes `viewer_header_checks.page_id`. */
	id: number;
	/** `pages.url` — becomes `viewer_header_checks.url_sort_key` verbatim. */
	url: string;
};

/** One row to insert into `viewer_header_checks`. */
export interface HeaderCheckInsertRow {
	/** Copied from `pages.id`. */
	page_id: number;
	/** Copied from `pages.url` verbatim — see `viewer_header_checks`'s table docs. */
	url_sort_key: string;
	/** Normalised `0`/`1` form of {@link HeaderPresence.hasCSP}. */
	has_csp: 0 | 1;
	/** Normalised `0`/`1` form of {@link HeaderPresence.hasXFrameOptions}. */
	has_x_frame_options: 0 | 1;
	/** Normalised `0`/`1` form of {@link HeaderPresence.hasXContentTypeOptions}. */
	has_x_content_type_options: 0 | 1;
	/** Normalised `0`/`1` form of {@link HeaderPresence.hasHSTS}. */
	has_hsts: 0 | 1;
	/** Count of {@link HEADER_PRESENCE_KEYS} that are absent (`0`-`4`). */
	missing_count: number;
	/**
	 * `1` iff `missing_count > 0`, `0` otherwise — the boolean flag
	 * `listViewerHeaderChecks`'s `missingOnly` filter actually queries (see
	 * `viewer_header_checks`'s table docs for why `missing_count` itself,
	 * a range predicate, can't lead an index that also satisfies
	 * `ORDER BY url_sort_key`).
	 */
	is_missing: 0 | 1;
}

/**
 * Reads internal HTML pages — the exact `scraped = 1, isExternal = 0,
 * contentType = 'text/html', redirectDestId IS NULL` predicate `checkHeaders`
 * itself filters to — and computes each tracked security header's presence
 * entirely in SQL via `headerPresenceExpression`, the same LIKE-based boolean
 * expression `checkHeaders`/`listPages` already use. The `responseHeaders`
 * JSON blob itself is never selected, so this build step never transfers or
 * parses it — only the four resulting booleans per row.
 *
 * Unlike `computeAnchorFactRows`/`computeResourceInsertRows`/
 * `computeImageInsertRows`, this returns a plain array rather than an
 * `AsyncGenerator`: its row count is bounded by `pages`, the same order of
 * magnitude `viewer_pages`'s own non-chunked `sourceRows` read already
 * handles without chunking — there is no OOM risk here to chunk against.
 * @param trx - The archive's Knex instance (typically an open transaction).
 * @returns One row per matching page, ready to insert into `viewer_header_checks`.
 */
export async function computeHeaderCheckInsertRows(
	trx: Knex,
): Promise<HeaderCheckInsertRow[]> {
	const rows = (await trx('pages')
		.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
		.whereNull('redirectDestId')
		.select('id', 'url', ...buildHeaderPresenceSelects(trx))) as HeaderCheckSourceRow[];

	return rows.map((row) => {
		const missingCount = HEADER_PRESENCE_KEYS.reduce(
			(count, key) => count + (row[key] ? 0 : 1),
			0,
		);
		return {
			page_id: row.id,
			url_sort_key: row.url,
			has_csp: row.hasCSP ? 1 : 0,
			has_x_frame_options: row.hasXFrameOptions ? 1 : 0,
			has_x_content_type_options: row.hasXContentTypeOptions ? 1 : 0,
			has_hsts: row.hasHSTS ? 1 : 0,
			missing_count: missingCount,
			is_missing: missingCount > 0 ? 1 : 0,
		};
	});
}
