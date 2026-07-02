import type {
	ListPagesOptions,
	PageListFacets,
	PageListItem,
	PageListRow,
	PaginatedPageList,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyListOrder } from './apply-list-order.js';
import { applyCategoryFilter } from './content-type-rules.js';
import { mapPageRowToListItem, PAGE_LIST_COLUMNS } from './map-page-row-to-list-item.js';
import { paginateQuery } from './paginate-query.js';
import { ensureUrlSortTempTable } from './url-sort-temp-table.js';

type PageFacetRow = {
	status: number | null;
	lang: string | null;
	isExternal: 0 | 1;
};

/**
 * Narrows nullable SQL values before building distinct facet arrays.
 * @param value - Candidate value.
 * @returns Whether the value is non-nullish.
 */
function isPresent<T>(value: T | null | undefined): value is T {
	return value != null;
}

/**
 * Builds the base Pages universe before user-facing filters are applied.
 * @param knex - Knex instance.
 * @param contentTypeCategory - Optional category override.
 * @returns Query builder scoped to page-list rows.
 */
function createPageListBaseQuery(
	knex: ReturnType<ArchiveAccessor['getKnex']>,
	contentTypeCategory?: ListPagesOptions['contentTypeCategory'],
) {
	const baseQuery = knex('pages').where('scraped', 1).whereNull('redirectDestId');
	if (contentTypeCategory) {
		applyCategoryFilter(baseQuery, contentTypeCategory);
	} else {
		baseQuery.where((qb) => {
			qb.whereNull('contentType').orWhere('contentType', 'text/html');
		});
	}
	return baseQuery;
}

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
	const baseQuery = createPageListBaseQuery(knex, options.contentTypeCategory);

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
	if (options.lang) {
		baseQuery.where('lang', options.lang);
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
	const useUrlSort = sortBy === 'url';
	if (useUrlSort) {
		await ensureUrlSortTempTable(accessor);
	}

	const [result, facets] = await Promise.all([
		paginateQuery<PageListRow, PageListItem>({
			baseQuery,
			countColumn: 'id',
			applySelect: (q) =>
				applyListOrder(q.select(...PAGE_LIST_COLUMNS), knex, sortBy, sortOrder, {
					url: { column: '"pages"."url"', type: useUrlSort ? 'url' : 'plain' },
					status: { column: '"pages"."status"' },
					title: { column: '"pages"."title"' },
					contentType: { column: '"pages"."contentType"' },
					isExternal: { column: '"pages"."isExternal"' },
					lang: { column: '"pages"."lang"' },
					description: { column: '"pages"."description"' },
					keywords: { column: '"pages"."keywords"' },
					noindex: { column: '"pages"."robots_noindex"' },
					nofollow: { column: '"pages"."robots_nofollow"' },
					noarchive: { column: '"pages"."robots_noarchive"' },
					canonical: { column: '"pages"."canonical"', type: 'url' },
					twitterCard: { column: '"pages"."twitter_card"' },
					ogSiteName: { column: '"pages"."og_site_name"' },
					ogUrl: { column: '"pages"."og_url"', type: 'url' },
					ogTitle: { column: '"pages"."og_title"' },
					ogDescription: { column: '"pages"."og_description"' },
					ogType: { column: '"pages"."og_type"' },
					ogImage: { column: '"pages"."og_image"', type: 'url' },
					ogImageAlt: { column: '"pages"."og_image_alt"' },
					ogLocale: { column: '"pages"."og_locale"' },
					ogArticlePublishedTime: {
						column: '"pages"."og_article_published_time"',
					},
					twitterSite: { column: '"pages"."twitter_site"' },
					twitterCreator: { column: '"pages"."twitter_creator"' },
					twitterImage: { column: '"pages"."twitter_image"', type: 'url' },
					charset: { column: '"pages"."charset"' },
					themeColor: { column: '"pages"."themeColor"' },
					manifest: { column: '"pages"."manifest"', type: 'url' },
					robotsRaw: { column: '"pages"."robots_raw"' },
					tagCount: { column: '"pages"."tag_count"' },
					tagsProvidersCsv: { column: '"pages"."tags_providers_csv"' },
					jsonldCount: { column: '"pages"."jsonld_count"' },
				}),
			limit,
			offset,
			mapRow: mapPageRowToListItem,
		}),
		getPageListFacets(knex, options.contentTypeCategory),
	]);
	return { ...result, facets };
}

/**
 * Lists dynamic enum filter candidates for the Pages table.
 * @param knex - Knex instance.
 * @param contentTypeCategory - Optional category override.
 * @returns Facet candidates.
 */
async function getPageListFacets(
	knex: ReturnType<ArchiveAccessor['getKnex']>,
	contentTypeCategory?: ListPagesOptions['contentTypeCategory'],
): Promise<PageListFacets> {
	const rows = (await createPageListBaseQuery(knex, contentTypeCategory)
		.clone()
		.distinct('status', 'lang', 'isExternal')) as PageFacetRow[];
	return {
		statuses: [...new Set(rows.map((row) => row.status).filter(isPresent))].toSorted(
			(a, b) => a - b,
		),
		langs: [...new Set(rows.map((row) => row.lang).filter(isPresent))].toSorted((a, b) =>
			a.localeCompare(b),
		),
		types: [...new Set(rows.map((row) => Boolean(row.isExternal)))].toSorted(
			(a, b) => Number(a) - Number(b),
		),
	};
}
