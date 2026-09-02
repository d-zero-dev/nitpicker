import type { PageDirectoryPrefix, PageListRowFilterOptions } from './types.js';
import type { Knex } from 'knex';

import { applyEqualityOrInFilter } from '../apply-equality-or-in-filter.js';
import { applyViewerPagesFilters } from '../apply-viewer-pages-filters.js';

import { parsePageDirectoryPrefix } from './parse-page-directory-prefix.js';

/**
 * Upper bound of a directory subtree range: the directory's path plus the
 * highest BMP code point, a sentinel no real path segment sorts past. Same
 * technique (and same reason to prefer a `>=`/`<` range over `LIKE 'dir%'`)
 * as `applyViewerPagesFilters`' `directory` option.
 */
const PATH_RANGE_END = '\uFFFF';

/**
 * Restricts one OR arm to a single directory prefix: the directory's own
 * page, or anything beneath it. The equality arm is what makes `/blog` cover
 * the page `/blog` itself — the subtree range alone starts at `/blog/`, and a
 * report listing "the /blog directory" that omitted the directory index
 * would be missing the row users look for first. The boundary is the `/`
 * separator, never a bare string prefix, so `/blogging` is not in `/blog`.
 * @param qb - A `viewer_pages`-scoped grouped query builder for this arm.
 * @param prefix - The parsed prefix this arm matches.
 */
function applyDirectoryPrefix(qb: Knex.QueryBuilder, prefix: PageDirectoryPrefix): void {
	if (prefix.hostname != null) {
		qb.where('hostname', prefix.hostname);
	}
	if (prefix.pathname === '') {
		return;
	}
	const dir = `${prefix.pathname}/`;
	qb.where((boundary) => {
		boundary
			.where('path_sort_key', prefix.pathname)
			.orWhere((subtree) =>
				subtree
					.where('path_sort_key', '>=', dir)
					.andWhere('path_sort_key', '<', `${dir}${PATH_RANGE_END}`),
			);
	});
}

/**
 * Applies the Page List row set's predicates to a `viewer_pages`-scoped
 * query builder: the internal-pages base restriction, plus the caller's
 * optional directory-prefix filters.
 *
 * Shared by `streamPageListRows`, `countPageListRows` and
 * `countPageListHostnames` so a report's row count, host count and streamed
 * rows can never disagree about which pages are in scope — the same reason
 * `countViewerPagesTotal` and the viewer's id-resolution query both go
 * through `applyViewerPagesFilters`.
 *
 * The base restriction is `isExternal: false` handed to
 * {@link applyViewerPagesFilters}, which additionally applies its default
 * `content_category IN ('html', 'unknown')` — i.e. crawled internal pages
 * that are HTML or not-yet-classified, excluding PDFs/images and every
 * link-only external URL.
 *
 * The directory filters are `OR`-ed together and evaluated as residual
 * predicates on top of that scan: every reader of this row set sweeps the
 * whole (narrow, index-covered) `viewer_pages` table in `natural_url_rank`
 * order or counts it outright, so there is no seek for a `vp_path` range to
 * accelerate — `vp_path` leads with `path_sort_key` while these queries are
 * driven by `vp_default`'s `is_external`/`content_category` prefix. Filtering
 * here rather than in the caller's JS is still what keeps the row count and
 * the streamed rows in agreement, and lets the count avoid materialising
 * rows at all.
 * @param qb - A Knex query builder scoped to `viewer_pages`.
 * @param options - The caller's directory filters, if any.
 * @throws {TypeError} If a `directories` entry is not a usable prefix (see
 *   {@link parsePageDirectoryPrefix}).
 * `options.urls` is applied as a plain `AND url IN (...)` restriction (via
 * `applyEqualityOrInFilter`, chunked below `SQLITE_LIMIT_VARIABLE_NUMBER`) on
 * top of the base restriction and any `directories` filter — a page must
 * satisfy both, not either.
 * @example
 * const qb = knex('viewer_pages');
 * applyPageListRowFilters(qb, { directories: ['/blog', 'https://example.com/news/'] });
 * @example
 * applyPageListRowFilters(qb, { urls: ['https://example.com/a', 'https://example.com/b'] });
 */
export function applyPageListRowFilters(
	qb: Knex.QueryBuilder,
	options: PageListRowFilterOptions,
): void {
	applyViewerPagesFilters(qb, { isExternal: false });
	applyEqualityOrInFilter(qb, 'url', options.urls);

	const prefixes = (options.directories ?? []).map((directory) =>
		parsePageDirectoryPrefix(directory),
	);
	if (prefixes.length === 0) {
		return;
	}
	// A filter naming neither a host nor a path (`/`) matches every page, and
	// the union of it with anything else is still every page. Returning here
	// keeps that case a predicate-free scan instead of an OR arm with no
	// conditions in it, which knex would emit as empty parentheses.
	if (prefixes.some((prefix) => prefix.hostname == null && prefix.pathname === '')) {
		return;
	}
	qb.where((outer) => {
		for (const [index, prefix] of prefixes.entries()) {
			const arm = (builder: Knex.QueryBuilder): void => {
				applyDirectoryPrefix(builder, prefix);
			};
			// The group's first arm is added with `where` rather than relying on
			// knex dropping a leading `or`.
			if (index === 0) {
				outer.where(arm);
			} else {
				outer.orWhere(arm);
			}
		}
	});
}
