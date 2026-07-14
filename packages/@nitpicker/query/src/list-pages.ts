import type {
	ListPagesOptions,
	PageListFacets,
	PageListItem,
	PageListRow,
	PaginatedPageList,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyListOrder } from './apply-list-order.js';
import { buildHeaderPresenceSelects } from './build-header-presence-selects.js';
import { applyCategoryFilter } from './content-type-rules.js';
import { HEADER_PRESENCE_KEYS, headerPresenceExpression } from './header-presence-sql.js';
import {
	PAGE_LIST_SELECT_COLUMNS,
	mapPageRowToListItem,
} from './map-page-row-to-list-item.js';
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
 * 0.13: builds the base Pages universe before user-facing filters are
 * applied, using the 0.13 `content_items` entity table plus `page_meta`
 * (LEFT JOIN because 0.13 populates `page_meta` only for
 * `scraped = 1` pages), joined to `url_refs`, `content_type_refs`, and
 * `header_flags`. Column projections are wired via
 * {@link PAGE_LIST_SELECT_COLUMNS} so `PageListRow` keeps its pre-6 shape.
 * @param knex - Knex instance.
 * @param contentTypeCategory - Optional category override.
 * @returns Query builder scoped to page-list rows.
 */
function createPageListBaseQuery(
	knex: ReturnType<ArchiveAccessor['getKnex']>,
	contentTypeCategory?: ListPagesOptions['contentTypeCategory'],
) {
	const baseQuery = knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
		.leftJoin('page_meta as pm', 'pm.page_id', 'ci.id')
		.leftJoin('header_flags as hf', 'hf.header_set_id', 'ci.header_set_id')
		.leftJoin('text_refs as title_ref', 'title_ref.id', 'pm.title_text_id')
		.leftJoin(
			'text_refs as description_ref',
			'description_ref.id',
			'pm.description_text_id',
		)
		.leftJoin('text_refs as keywords_ref', 'keywords_ref.id', 'pm.keywords_text_id')
		.leftJoin('text_refs as robots_raw_ref', 'robots_raw_ref.id', 'pm.robots_raw_text_id')
		.leftJoin('text_refs as og_title_ref', 'og_title_ref.id', 'pm.og_title_text_id')
		.leftJoin(
			'text_refs as og_description_ref',
			'og_description_ref.id',
			'pm.og_description_text_id',
		)
		.leftJoin('url_refs as canonical_ur', 'canonical_ur.id', 'pm.canonical_url_id')
		.leftJoin('url_refs as og_url_ur', 'og_url_ur.id', 'pm.og_url_id')
		.leftJoin('url_refs as og_image_ur', 'og_image_ur.id', 'pm.og_image_url_id')
		.leftJoin(
			'url_refs as twitter_image_ur',
			'twitter_image_ur.id',
			'pm.twitter_image_url_id',
		)
		.leftJoin('url_refs as manifest_ur', 'manifest_ur.id', 'pm.manifest_url_id')
		.where('ci.scraped', 1)
		.whereNull('ci.redirect_dest_id');
	if (contentTypeCategory) {
		applyCategoryFilter(baseQuery, contentTypeCategory);
	} else {
		baseQuery.where((qb) => {
			qb.whereNull('ctr.raw').orWhere('ctr.raw', 'text/html');
		});
	}
	return baseQuery;
}

/**
 * Lists pages from the archive with filtering, sorting, and pagination.
 *
 * 0.13: reads through 0.13 entity tables; every metadata column
 * that previously lived inline on `pages` is now resolved via `page_meta`
 * plus one of `text_refs`/`url_refs` (see {@link createPageListBaseQuery}).
 * Header-presence flags come from 0.13 `header_flags`.
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

	const baseQuery = createPageListBaseQuery(knex, options.contentTypeCategory);

	if (options.status != null) {
		baseQuery.where('ci.status', options.status);
	}
	if (options.statusMin != null) {
		baseQuery.where('ci.status', '>=', options.statusMin);
	}
	if (options.statusMax != null) {
		baseQuery.where('ci.status', '<=', options.statusMax);
	}
	if (options.isExternal != null) {
		baseQuery.where('ci.is_external', options.isExternal ? 1 : 0);
	}
	if (options.lang) {
		baseQuery.where('pm.lang', options.lang);
	}
	if (options.missingTitle) {
		baseQuery.where((qb) => {
			qb.whereNull('title_ref.text').orWhere('title_ref.text', '');
		});
	}
	if (options.missingDescription) {
		baseQuery.where((qb) => {
			qb.whereNull('description_ref.text').orWhere('description_ref.text', '');
		});
	}
	if (options.noindex) {
		baseQuery.where('pm.robots_noindex', 1);
	}
	if (options.urlPattern) {
		baseQuery.where('ur.url', 'like', options.urlPattern);
	}
	if (options.directory) {
		const dir = options.directory.endsWith('/')
			? options.directory
			: `${options.directory}/`;
		baseQuery.where('ur.url', 'like', `%${dir}%`);
	}
	for (const key of HEADER_PRESENCE_KEYS) {
		const expected = options[key];
		if (expected != null) {
			baseQuery.whereRaw(`${headerPresenceExpression(key, 'hf')} = ?`, [
				expected ? 1 : 0,
			]);
		}
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
			countColumn: 'ci.id',
			applySelect: (q) =>
				applyListOrder(
					q.select(
						...PAGE_LIST_SELECT_COLUMNS,
						...buildHeaderPresenceSelects(knex, 'hf'),
					),
					knex,
					sortBy,
					sortOrder,
					{
						url: { column: '"ur"."url"', type: useUrlSort ? 'url' : 'plain' },
						status: { column: '"ci"."status"' },
						title: { column: '"title_ref"."text"' },
						contentType: { column: '"ctr"."raw"' },
						isExternal: { column: '"ci"."is_external"' },
						lang: { column: '"pm"."lang"' },
						description: { column: '"description_ref"."text"' },
						keywords: { column: '"keywords_ref"."text"' },
						noindex: { column: '"pm"."robots_noindex"' },
						nofollow: { column: '"pm"."robots_nofollow"' },
						noarchive: { column: '"pm"."robots_noarchive"' },
						canonical: { column: '"canonical_ur"."url"', type: 'url' },
						twitterCard: { column: '"pm"."twitter_card"' },
						ogSiteName: { column: '"pm"."og_site_name"' },
						ogUrl: { column: '"og_url_ur"."url"', type: 'url' },
						ogTitle: { column: '"og_title_ref"."text"' },
						ogDescription: { column: '"og_description_ref"."text"' },
						ogType: { column: '"pm"."og_type"' },
						ogImage: { column: '"og_image_ur"."url"', type: 'url' },
						ogImageAlt: { column: '"pm"."og_image_alt"' },
						ogLocale: { column: '"pm"."og_locale"' },
						ogArticlePublishedTime: { column: '"pm"."og_article_published_time"' },
						twitterSite: { column: '"pm"."twitter_site"' },
						twitterCreator: { column: '"pm"."twitter_creator"' },
						twitterImage: { column: '"twitter_image_ur"."url"', type: 'url' },
						charset: { column: '"pm"."charset"' },
						themeColor: { column: '"pm"."theme_color"' },
						manifest: { column: '"manifest_ur"."url"', type: 'url' },
						robotsRaw: { column: '"robots_raw_ref"."text"' },
						tagCount: { column: '"pm"."tag_count"' },
						tagsProvidersCsv: { column: '"pm"."tags_providers_csv"' },
						jsonldCount: { column: '"pm"."jsonld_count"' },
						hasCSP: { column: headerPresenceExpression('hasCSP', 'hf') },
						hasXFrameOptions: {
							column: headerPresenceExpression('hasXFrameOptions', 'hf'),
						},
						hasXContentTypeOptions: {
							column: headerPresenceExpression('hasXContentTypeOptions', 'hf'),
						},
						hasHSTS: { column: headerPresenceExpression('hasHSTS', 'hf') },
					},
				),
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
		.distinct(
			'ci.status as status',
			'pm.lang as lang',
			'ci.is_external as isExternal',
		)) as PageFacetRow[];
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
