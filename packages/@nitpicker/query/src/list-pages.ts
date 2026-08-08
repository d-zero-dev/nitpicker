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
import { hasDedupeCapEventIdColumn } from './has-dedupe-cap-event-id-column.js';
import { HEADER_PRESENCE_KEYS, headerPresenceExpression } from './header-presence-sql.js';
import {
	PAGE_LIST_SELECT_COLUMNS,
	mapPageRowToListItem,
} from './map-page-row-to-list-item.js';
import { hasPageTemplatesTable, templateKeySelectColumn } from './page-templates-join.js';
import { paginateQuery } from './paginate-query.js';
import { requireAliasOfIdColumn } from './require-alias-of-id-column.js';
import { requireConsoleErrorCountColumn } from './require-console-error-count-column.js';
import { ensureUrlSortTempTable } from './url-sort-temp-table.js';

/** One DISTINCT row read for facet computation — see {@link getPageListFacets}. */
type PageFacetRow = {
	/** HTTP status, or `null` for not-yet-classified/errored rows. */
	status: number | null;
	/** Document language, or `null` when absent. */
	lang: string | null;
	/** SQLite boolean: `1` for external pages, `0` for internal. */
	isExternal: 0 | 1;
	/** `--templates` classification group key, or `null` when absent/unclassified. */
	templateKey: string | null;
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
 * {@link PAGE_LIST_SELECT_COLUMNS} so every page-list query emits the same
 * `PageListRow` shape.
 * @param knex - Knex instance.
 * @param contentTypeCategory - Optional category override.
 * @param hasPageTemplates - Result of {@link hasPageTemplatesTable} for this
 *   connection; gates the `page_templates` join (see that function's doc).
 * @returns Query builder scoped to page-list rows.
 */
function createPageListBaseQuery(
	knex: ReturnType<ArchiveAccessor['getKnex']>,
	contentTypeCategory: ListPagesOptions['contentTypeCategory'] | undefined,
	hasPageTemplates: boolean,
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
		.whereNull('ci.redirect_dest_id')
		.whereNull('ci.alias_of_id');
	if (hasPageTemplates) {
		baseQuery.leftJoin('page_templates as pt', 'pt.page_id', 'ci.id');
	}
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
 * is resolved via `page_meta` plus one of `text_refs`/`url_refs`
 * (see {@link createPageListBaseQuery}). Header-presence flags come from
 * 0.13 `header_flags`.
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options.
 * @returns A paginated list of page entries with metadata.
 * @example
 * // SEO sweep: internal pages with no description, 100 at a time.
 * const { items, total, facets } = await listPages(accessor, {
 *   isExternal: false,
 *   missingDescription: true,
 *   sortBy: 'url',
 * });
 */
export async function listPages(
	accessor: ArchiveAccessor,
	options: ListPagesOptions = {},
): Promise<PaginatedPageList> {
	const knex = accessor.getKnex();
	await requireAliasOfIdColumn(knex);
	await requireConsoleErrorCountColumn(knex);
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const hasPageTemplates = await hasPageTemplatesTable(knex);
	const hasDedupeCapColumn = await hasDedupeCapEventIdColumn(knex);

	const baseQuery = createPageListBaseQuery(
		knex,
		options.contentTypeCategory,
		hasPageTemplates,
	);

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
	if (options.isDedupeCapped != null) {
		if (hasDedupeCapColumn) {
			if (options.isDedupeCapped) {
				baseQuery.whereNotNull('ci.dedupe_cap_event_id');
			} else {
				baseQuery.whereNull('ci.dedupe_cap_event_id');
			}
		} else if (options.isDedupeCapped) {
			// No archive predating this feature has ever marked a page — a
			// missing column deterministically yields zero rows for `true`
			// instead of throwing on a reference to a column that doesn't
			// exist. `false` needs no such guard: every row already
			// satisfies "not capped" when the column is absent, so it's a
			// no-op (same asymmetry as `templateKey`'s guard above).
			baseQuery.whereRaw('0 = 1');
		}
	}
	if (options.urlPattern) {
		const urlPattern = options.urlPattern;
		// Matches the canonical page's own URL, OR any URL that resolves to
		// it — via an HTTP redirect (`redirect_dest_id`) or a
		// URL-normalization alias (`alias_of_id`). Both are genuinely
		// different relationships (one is an observed HTTP 3xx, the other a
		// same-body/URL-shape inference) but a search for either kind of
		// source URL (e.g. `https://example.com` redirecting to
		// `https://example.com/index.html`, or `/index.html` merged as an
		// alias of `/`) must still surface the one row that survives after
		// the exclusions above, not silently miss it — so each gets its own
		// named subquery rather than being folded into one opaque `OR`.
		//
		// Each side is expressed as `ci.id IN (SELECT ... )` rather than a
		// correlated `EXISTS` subquery: `EXPLAIN QUERY PLAN` on a ~450k-row
		// real archive showed `orWhereExists` compiles to a `CORRELATED
		// SCALAR SUBQUERY` re-run once per row of the outer `scraped = 1`
		// scan (visibly slow in the viewer on that archive), while the `IN`
		// form is a `LIST SUBQUERY` — computed once and probed via a Bloom
		// filter — even though both return the same rows. The two sides are
		// combined with `UNION ALL` (not folded into a single `OR` across
		// `redirect_dest_id/alias_of_id`): a row is never both a redirect
		// source and an alias member, so `UNION ALL` cannot double-count,
		// and each arm keeps its own index-backed plan (see
		// `compute-isolated-clusters.ts` for the same `OR`-across-columns
		// pitfall on this exact pair of columns).
		const redirectMatchIds = knex('content_items as redirect_ci')
			.select('redirect_ci.redirect_dest_id')
			.join('url_refs as redirect_ur', 'redirect_ur.id', 'redirect_ci.url_id')
			.whereNotNull('redirect_ci.redirect_dest_id')
			.andWhere('redirect_ur.url', 'like', urlPattern);
		const equivalentIds = redirectMatchIds.unionAll(
			knex('content_items as alias_ci')
				.select('alias_ci.alias_of_id')
				.join('url_refs as alias_ur', 'alias_ur.id', 'alias_ci.url_id')
				.whereNotNull('alias_ci.alias_of_id')
				.andWhere('alias_ur.url', 'like', urlPattern),
		);
		baseQuery.where((qb) => {
			qb.where('ur.url', 'like', urlPattern).orWhereIn('ci.id', equivalentIds);
		});
	}
	if (options.directory) {
		const dir = options.directory.endsWith('/')
			? options.directory
			: `${options.directory}/`;
		baseQuery.where('ur.url', 'like', `%${dir}%`);
	}
	if (options.templateKey) {
		// `pt` only exists in the FROM clause when `hasPageTemplates` — see
		// `createPageListBaseQuery`. Without the table, no page has a
		// `templateKey` classification, so the filter deterministically
		// yields zero rows instead of referencing a missing column.
		if (hasPageTemplates) {
			baseQuery.where('pt.template_key', options.templateKey);
		} else {
			baseQuery.whereRaw('0 = 1');
		}
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
						templateKeySelectColumn(knex, hasPageTemplates),
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
						mainContentNodeName: { column: '"pm"."main_content_node_name"' },
						mainContentId: { column: '"pm"."main_content_id"' },
						mainContentRole: { column: '"pm"."main_content_role"' },
						mainContentSelector: { column: '"pm"."main_content_selector"' },
						mainContentWordCount: { column: '"pm"."main_content_word_count"' },
						mainContentBodyWordCount: {
							column: '"pm"."main_content_body_word_count"',
						},
						mainContentHeadingCount: { column: '"pm"."main_content_heading_count"' },
						mainContentImageCount: { column: '"pm"."main_content_image_count"' },
						mainContentTableCount: { column: '"pm"."main_content_table_count"' },
						mainContentButtonCount: { column: '"pm"."main_content_button_count"' },
						mainContentIframeCount: { column: '"pm"."main_content_iframe_count"' },
						mainContentVideoCount: { column: '"pm"."main_content_video_count"' },
						mainContentAudioCount: { column: '"pm"."main_content_audio_count"' },
						mainContentCanvasCount: { column: '"pm"."main_content_canvas_count"' },
						scrollHeightDesktop: { column: '"pm"."scroll_height_desktop"' },
						scrollHeightMobile: { column: '"pm"."scroll_height_mobile"' },
						consoleErrorCount: { column: '"pm"."console_error_count"' },
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
		getPageListFacets(knex, options.contentTypeCategory, hasPageTemplates),
	]);
	return { ...result, facets };
}

/**
 * Lists dynamic enum filter candidates for the Pages table.
 * @param knex - Knex instance.
 * @param contentTypeCategory - Optional category override.
 * @param hasPageTemplates - Result of {@link hasPageTemplatesTable} for this connection.
 * @returns Facet candidates.
 */
async function getPageListFacets(
	knex: ReturnType<ArchiveAccessor['getKnex']>,
	contentTypeCategory: ListPagesOptions['contentTypeCategory'] | undefined,
	hasPageTemplates: boolean,
): Promise<PageListFacets> {
	const rows = (await createPageListBaseQuery(knex, contentTypeCategory, hasPageTemplates)
		.clone()
		.distinct(
			'ci.status as status',
			'pm.lang as lang',
			'ci.is_external as isExternal',
			templateKeySelectColumn(knex, hasPageTemplates),
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
		templateKeys: [
			...new Set(rows.map((row) => row.templateKey).filter(isPresent)),
		].toSorted((a, b) => a.localeCompare(b)),
	};
}
