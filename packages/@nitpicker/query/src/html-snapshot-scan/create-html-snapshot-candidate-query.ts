import type { HtmlSnapshotPageFilters } from './types.js';
import type { Knex } from 'knex';

import { applyUrlDirectoryFilter } from '../apply-url-directory-filter.js';
import { excludeSkippedPages } from '../exclude-skipped-pages.js';

/**
 * Builds the query of the pages whose HTML snapshot can be searched: pages
 * with a `page_html_ref` row that are not `is_skipped`, optionally narrowed
 * by URL. Every HTML search (`searchHtml`, `matchSelector`) starts from this
 * one predicate so they never disagree about which pages are searchable.
 * The `url_refs` join is there for the URL filters and does not narrow the
 * set: `content_items.url_id` is `NOT NULL` and a foreign key.
 * @param knex - The archive's Knex instance.
 * @param filters - URL filters; omit to keep every searchable page.
 * @returns A fresh query over `page_html_ref as phr` joined to `content_items as ci` and `url_refs as ur`.
 * @example
 * const [row] = await createHtmlSnapshotCandidateQuery(knex, { directory: '/blog' })
 *   .countDistinct({ count: 'ci.id' });
 */
export function createHtmlSnapshotCandidateQuery(
	knex: Knex,
	filters: HtmlSnapshotPageFilters = {},
): Knex.QueryBuilder {
	const query = knex('page_html_ref as phr')
		.join('content_items as ci', 'ci.id', 'phr.page_id')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.where((qb) => excludeSkippedPages(qb, 'ci.is_skipped'));
	if (filters.urlPattern) {
		query.where('ur.url', 'like', filters.urlPattern);
	}
	if (filters.directory) {
		applyUrlDirectoryFilter(query, filters.directory);
	}
	return query;
}
