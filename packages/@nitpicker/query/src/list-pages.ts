import type {
	ListPagesOptions,
	PageListItem,
	PageListRow,
	PaginatedPageList,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyCategoryFilter } from './content-type-rules.js';
import { mapPageRowToListItem, PAGE_LIST_COLUMNS } from './map-page-row-to-list-item.js';
import { paginateQuery } from './paginate-query.js';

/**
 * Lists pages from the archive with filtering, sorting, and pagination.
 * Applies filters at the SQL level for performance with large datasets.
 *
 * Returns the per-page metadata derived from beholder 3.0.0 nested Meta
 * (title, language, description, keywords, robots flags, canonical, OGP,
 * Twitter card, charset, themeColor, manifest, denormalised aggregates,
 * timestamps). `meta_extras` is intentionally excluded — list views are
 * size-bounded for viewer / MCP / Sheets; fetch the full payload via
 * `getPageDetail(url)` when extras are needed.
 *
 * Per-page link/referrer counts are still omitted here (they require anchor
 * aggregation); see `listPageLinks` for those.
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options.
 * @returns A paginated list of page entries with metadata.
 */
export async function listPages(
	accessor: ArchiveAccessor,
	options: ListPagesOptions = {},
): Promise<PaginatedPageList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	// "Pages" = HTML pages PLUS not-yet-classified rows (errored / unreachable,
	// whose `contentType` is null) so broken pages stay visible to the audit. Only
	// KNOWN non-HTML resources (PDF / zip / image, `contentType` like
	// 'application/pdf') are excluded — they live in the Resources view. Page-ness
	// is content type, NOT `isTarget` (an in-scope PDF is `isTarget = 1`).
	//
	// When `contentTypeCategory` is supplied, the default is RELAXED and the
	// rule-table SQL matcher is used instead — the user has explicitly asked to
	// browse a non-HTML category (PDFs, images...) that the Pages view normally
	// hides.
	const baseQuery = knex('pages').where('scraped', 1).whereNull('redirectDestId');
	if (options.contentTypeCategory) {
		applyCategoryFilter(baseQuery, options.contentTypeCategory);
	} else {
		baseQuery.where((qb) => {
			qb.whereNull('contentType').orWhere('contentType', 'text/html');
		});
	}

	if (options.status != null) {
		baseQuery.where('status', options.status);
	}
	if (options.statusMin != null) {
		baseQuery.where('status', '>=', options.statusMin);
	}
	if (options.statusMax != null) {
		baseQuery.where('status', '<=', options.statusMax);
	}
	if (options.isExternal != null) {
		baseQuery.where('isExternal', options.isExternal ? 1 : 0);
	}
	if (options.missingTitle) {
		baseQuery.where((qb) => {
			qb.whereNull('title').orWhere('title', '');
		});
	}
	if (options.missingDescription) {
		baseQuery.where((qb) => {
			qb.whereNull('description').orWhere('description', '');
		});
	}
	if (options.noindex) {
		baseQuery.where('robots_noindex', 1);
	}
	if (options.urlPattern) {
		baseQuery.where('url', 'like', options.urlPattern);
	}
	if (options.directory) {
		const dir = options.directory.endsWith('/')
			? options.directory
			: `${options.directory}/`;
		baseQuery.where('url', 'like', `%${dir}%`);
	}

	const sortBy = options.sortBy ?? 'url';
	const sortOrder = options.sortOrder ?? 'asc';

	return paginateQuery<PageListRow, PageListItem>({
		baseQuery,
		countColumn: 'id',
		applySelect: (q) => q.select(...PAGE_LIST_COLUMNS).orderBy(sortBy, sortOrder),
		limit,
		offset,
		mapRow: mapPageRowToListItem,
	});
}
