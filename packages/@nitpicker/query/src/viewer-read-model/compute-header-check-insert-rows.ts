import type { HeaderPresence, HeaderPresenceKey } from '../types.js';
import type { Knex } from 'knex';

import { buildHeaderPresenceSelects } from '../build-header-presence-selects.js';
import { HEADER_PRESENCE_KEYS } from '../header-presence-sql.js';

/** One row projected from `content_items` + refs, just the columns this computation needs. */
type HeaderCheckSourceRow = Record<HeaderPresenceKey, 0 | 1> & {
	/** `content_items.id` — becomes `viewer_header_checks.page_id`. */
	id: number;
	/** `url_refs.url` (verbatim URL string) — becomes `viewer_header_checks.url_sort_key`. */
	url: string;
};

/** One row to insert into `viewer_header_checks`. */
export interface HeaderCheckInsertRow {
	/** Copied from `content_items.id` (= legacy `pages.id`). */
	page_id: number;
	/** Copied from `url_refs.url` verbatim — see `viewer_header_checks`'s table docs. */
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
	 * `listViewerHeaderChecks`'s `missingOnly` filter actually queries.
	 */
	is_missing: 0 | 1;
}

/**
 * Reads internal HTML pages via 0.13 entity tables — the exact
 * `scraped = 1, is_external = 0, content_type='text/html',
 * redirect_dest_id IS NULL` predicate `checkHeaders` itself filters to — and
 * projects each tracked security header's presence directly from
 * `header_flags`'s pre-computed booleans. `content_items.header_set_id` may
 * be NULL for pages with no captured response headers; the LEFT JOIN +
 * `coalesce(..., 0)` inside {@link buildHeaderPresenceSelects} treats those
 * as "header absent", matching the pre-Phase-6 LIKE-on-NULL behaviour.
 *
 * Unlike `computeAnchorFactRows`/`computeResourceInsertRows`/
 * `computeImageInsertRows`, this returns a plain array rather than an
 * `AsyncGenerator`: its row count is bounded by `content_items`, the same
 * order of magnitude `viewer_pages`'s own non-chunked `sourceRows` read
 * already handles without chunking — there is no OOM risk here to chunk
 * against.
 * @param trx - The archive's Knex instance (typically an open transaction).
 * @returns One row per matching page, ready to insert into `viewer_header_checks`.
 */
export async function computeHeaderCheckInsertRows(
	trx: Knex,
): Promise<HeaderCheckInsertRow[]> {
	const rows = (await trx('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
		.leftJoin('header_flags as hf', 'hf.header_set_id', 'ci.header_set_id')
		.where({ 'ci.scraped': 1, 'ci.is_external': 0, 'ctr.raw': 'text/html' })
		.whereNull('ci.redirect_dest_id')
		.select(
			'ci.id as id',
			'ur.url as url',
			...buildHeaderPresenceSelects(trx, 'hf'),
		)) as HeaderCheckSourceRow[];

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
