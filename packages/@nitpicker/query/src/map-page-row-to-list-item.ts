import type { PageListItem, PageListRow } from './types.js';

/**
 * Legacy column-name list retained for pre-0.13 fallback callers (kept as
 * a stringified `pages.*` list). 0.13 readers should prefer
 * {@link PAGE_LIST_SELECT_COLUMNS} which projects the same shape via aliased
 * `content_items`/`page_meta`/refs joins.
 */
export const PAGE_LIST_COLUMNS: readonly string[] = [
	'url',
	'title',
	'status',
	'contentType',
	'isExternal',
	'description',
	'keywords',
	'lang',
	'charset',
	'themeColor',
	'manifest',
	'robots_raw',
	'robots_noindex',
	'robots_nofollow',
	'robots_noarchive',
	'canonical',
	'og_type',
	'og_title',
	'og_site_name',
	'og_description',
	'og_url',
	'og_image',
	'og_image_alt',
	'og_locale',
	'og_article_published_time',
	'twitter_card',
	'twitter_site',
	'twitter_creator',
	'twitter_image',
	'tag_count',
	'jsonld_count',
	'tags_providers_csv',
	'main_content_node_name',
	'main_content_id',
	'main_content_role',
	'main_content_selector',
	'main_content_class_list',
	'main_content_word_count',
	'main_content_body_word_count',
	'main_content_heading_count',
	'main_content_image_count',
	'main_content_table_count',
	'main_content_button_count',
	'main_content_iframe_count',
	'main_content_video_count',
	'main_content_audio_count',
	'main_content_canvas_count',
	'main_content_custom_element_count',
	'scroll_height_desktop',
	'scroll_height_mobile',
	'console_error_count',
	'firstCrawledAt',
	'lastCrawledAt',
];

/**
 * 0.13: aliased SQL projection list that produces the exact same
 * {@link PageListRow} column shape as {@link PAGE_LIST_COLUMNS} but sources
 * every column through the 0.13 entity tables:
 * `content_items` (`ci`), `page_meta` (`pm`), `url_refs` (`ur` /
 * `canonical_ur` / `og_url_ur` / `og_image_ur` / `twitter_image_ur` /
 * `manifest_ur`), `content_type_refs` (`ctr`), and per-field
 * `text_refs` (`title_ref` / `description_ref` / `keywords_ref` /
 * `robots_raw_ref` / `og_title_ref` / `og_description_ref`).
 *
 * `templateKey` (from `page_templates`, `pt`) is deliberately NOT in this
 * list: that table may not exist yet on archives predating `--templates`
 * classification or on read-only connections (schema self-heal is skipped
 * — see `hasPageTemplatesTable` in `./page-templates-join.js`), so every
 * caller appends its own `templateKeySelectColumn(...)` result instead of
 * a fixed string, to fall back to a `NULL` literal when the table is
 * absent.
 *
 * `isDedupeCapped` (from `content_items.dedupe_cap_event_id`) is excluded
 * for the same reason: archives predating `--dedupe-cap`'s post-hoc marking
 * lack the column, so every caller appends its own
 * `isDedupeCappedSelectColumn(...)` result (`./is-dedupe-capped-select-column.js`)
 * instead of a fixed string, to fall back to a `0` literal when the column
 * is absent.
 *
 * All three page-list queries (`listPages`, `listPagesByTechnology`,
 * `listPagesByJsonLdType`) share this projection so their emitted DTO shape
 * stays lock-step with {@link PAGE_LIST_COLUMNS}.
 */
export const PAGE_LIST_SELECT_COLUMNS: readonly string[] = [
	'ur.url as url',
	'title_ref.text as title',
	'ci.status as status',
	'ctr.raw as contentType',
	'ci.is_external as isExternal',
	'description_ref.text as description',
	'keywords_ref.text as keywords',
	'pm.lang as lang',
	'pm.charset as charset',
	'pm.theme_color as themeColor',
	'manifest_ur.url as manifest',
	'robots_raw_ref.text as robots_raw',
	'pm.robots_noindex as robots_noindex',
	'pm.robots_nofollow as robots_nofollow',
	'pm.robots_noarchive as robots_noarchive',
	'canonical_ur.url as canonical',
	'pm.og_type as og_type',
	'og_title_ref.text as og_title',
	'pm.og_site_name as og_site_name',
	'og_description_ref.text as og_description',
	'og_url_ur.url as og_url',
	'og_image_ur.url as og_image',
	'pm.og_image_alt as og_image_alt',
	'pm.og_locale as og_locale',
	'pm.og_article_published_time as og_article_published_time',
	'pm.twitter_card as twitter_card',
	'pm.twitter_site as twitter_site',
	'pm.twitter_creator as twitter_creator',
	'twitter_image_ur.url as twitter_image',
	'pm.tag_count as tag_count',
	'pm.jsonld_count as jsonld_count',
	'pm.tags_providers_csv as tags_providers_csv',
	'pm.main_content_node_name as main_content_node_name',
	'pm.main_content_id as main_content_id',
	'pm.main_content_role as main_content_role',
	'pm.main_content_selector as main_content_selector',
	'pm.main_content_class_list as main_content_class_list',
	'pm.main_content_word_count as main_content_word_count',
	'pm.main_content_body_word_count as main_content_body_word_count',
	'pm.main_content_heading_count as main_content_heading_count',
	'pm.main_content_image_count as main_content_image_count',
	'pm.main_content_table_count as main_content_table_count',
	'pm.main_content_button_count as main_content_button_count',
	'pm.main_content_iframe_count as main_content_iframe_count',
	'pm.main_content_video_count as main_content_video_count',
	'pm.main_content_audio_count as main_content_audio_count',
	'pm.main_content_canvas_count as main_content_canvas_count',
	'pm.main_content_custom_element_count as main_content_custom_element_count',
	'pm.scroll_height_desktop as scroll_height_desktop',
	'pm.scroll_height_mobile as scroll_height_mobile',
	'pm.console_error_count as console_error_count',
	'ci.first_crawled_at as firstCrawledAt',
	'ci.last_crawled_at as lastCrawledAt',
];

/**
 * Returns `row` with every audit-signal field nulled/zeroed out — the same
 * columns `build-viewer-read-model.ts`'s `sanitizeRedirectSourceRow` clears
 * on `viewer_pages` itself. Needed here too: `joinViewerPageIdsToListItems`
 * re-fetches display data straight from `content_items`/`page_meta`, which
 * `sanitizeRedirectSourceRow` never touches (it only shapes the
 * `viewer_pages` insert row) — so without this, a redirect-source row would
 * surface whatever stale title/description/etc. it held from before it
 * became one (`linkRedirectSources` never clears `page_meta`).
 *
 * `firstCrawledAt`/`lastCrawledAt`, `templateKey`, and `isDedupeCapped` are
 * left untouched: they are provenance/classification facts about the row
 * itself, not audit signals about page content.
 * @param row - A row already known to be a redirect source
 *   (`row.isRedirectSource` truthy).
 */
function sanitizeRedirectSourcePageListRow(row: PageListRow): PageListRow {
	return {
		...row,
		title: null,
		contentType: null,
		description: null,
		keywords: null,
		lang: null,
		charset: null,
		themeColor: null,
		manifest: null,
		robots_raw: null,
		robots_noindex: null,
		robots_nofollow: null,
		robots_noarchive: null,
		canonical: null,
		og_type: null,
		og_title: null,
		og_site_name: null,
		og_description: null,
		og_url: null,
		og_image: null,
		og_image_alt: null,
		og_locale: null,
		og_article_published_time: null,
		twitter_card: null,
		twitter_site: null,
		twitter_creator: null,
		twitter_image: null,
		tag_count: null,
		jsonld_count: null,
		tags_providers_csv: null,
		main_content_node_name: null,
		main_content_id: null,
		main_content_role: null,
		main_content_selector: null,
		main_content_class_list: null,
		main_content_word_count: null,
		main_content_body_word_count: null,
		main_content_heading_count: null,
		main_content_image_count: null,
		main_content_table_count: null,
		main_content_button_count: null,
		main_content_iframe_count: null,
		main_content_video_count: null,
		main_content_audio_count: null,
		main_content_canvas_count: null,
		main_content_custom_element_count: null,
		scroll_height_desktop: null,
		scroll_height_mobile: null,
		console_error_count: null,
		hasCSP: 0,
		hasXFrameOptions: 0,
		hasXContentTypeOptions: 0,
		hasHSTS: 0,
	};
}

/**
 * Projects a {@link PageListRow} (raw SQL row) into the public
 * {@link PageListItem} DTO. Camel-cases column names, converts SQLite
 * 0/1 integers to booleans, and surfaces the denormalised aggregates as-is.
 *
 * Used by `listPages`, `listPagesByTechnology`, and `listPagesByJsonLdType`
 * so the three SQL paths produce an identical DTO shape.
 * @param row - One SQL row with the {@link PAGE_LIST_COLUMNS} columns.
 */
export function mapPageRowToListItem(row: PageListRow): PageListItem {
	const isRedirectSource = !!row.isRedirectSource;
	const source = isRedirectSource ? sanitizeRedirectSourcePageListRow(row) : row;
	return {
		url: source.url,
		title: source.title,
		status: source.status,
		contentType: source.contentType,
		isExternal: !!source.isExternal,
		hasDescription: source.description != null && source.description !== '',
		hasOgTitle: source.og_title != null && source.og_title !== '',
		noindex: !!source.robots_noindex,
		description: source.description,
		keywords: source.keywords,
		lang: source.lang,
		nofollow: !!source.robots_nofollow,
		noarchive: !!source.robots_noarchive,
		robotsRaw: source.robots_raw,
		canonical: source.canonical,
		ogType: source.og_type,
		ogTitle: source.og_title,
		ogSiteName: source.og_site_name,
		ogDescription: source.og_description,
		ogUrl: source.og_url,
		ogImage: source.og_image,
		ogImageAlt: source.og_image_alt,
		ogLocale: source.og_locale,
		ogArticlePublishedTime: source.og_article_published_time,
		twitterCard: source.twitter_card,
		twitterSite: source.twitter_site,
		twitterCreator: source.twitter_creator,
		twitterImage: source.twitter_image,
		charset: source.charset,
		themeColor: source.themeColor,
		manifest: source.manifest,
		tagCount: source.tag_count,
		jsonldCount: source.jsonld_count,
		tagsProvidersCsv: source.tags_providers_csv,
		mainContentNodeName: source.main_content_node_name,
		mainContentId: source.main_content_id,
		mainContentRole: source.main_content_role,
		mainContentSelector: source.main_content_selector,
		mainContentClassList:
			source.main_content_class_list == null
				? null
				: (JSON.parse(source.main_content_class_list) as string[]),
		mainContentWordCount: source.main_content_word_count,
		mainContentBodyWordCount: source.main_content_body_word_count,
		mainContentHeadingCount: source.main_content_heading_count,
		mainContentImageCount: source.main_content_image_count,
		mainContentTableCount: source.main_content_table_count,
		mainContentButtonCount: source.main_content_button_count,
		mainContentIframeCount: source.main_content_iframe_count,
		mainContentVideoCount: source.main_content_video_count,
		mainContentAudioCount: source.main_content_audio_count,
		mainContentCanvasCount: source.main_content_canvas_count,
		mainContentCustomElementCount: source.main_content_custom_element_count,
		scrollHeightDesktop: source.scroll_height_desktop,
		scrollHeightMobile: source.scroll_height_mobile,
		consoleErrorCount: source.console_error_count,
		firstCrawledAt: source.firstCrawledAt,
		lastCrawledAt: source.lastCrawledAt,
		hasCSP: !!source.hasCSP,
		hasXFrameOptions: !!source.hasXFrameOptions,
		hasXContentTypeOptions: !!source.hasXContentTypeOptions,
		hasHSTS: !!source.hasHSTS,
		templateKey: source.templateKey,
		isDedupeCapped: !!source.isDedupeCapped,
		// `undefined` on the three live-only paths (PAGE_LIST_SELECT_COLUMNS
		// never selects these) — defaulted to `null` here so every caller
		// gets a uniformly-shaped PageListItem regardless of path. Only
		// `joinViewerPageIdsToListItems` actually populates non-null values,
		// via its own extra `viewer_pages` join — see these fields' docs.
		displayTitle: source.displayTitle ?? null,
		inboundLinkCount: source.inboundLinkCount ?? null,
		dirIndexInboundLinkCount: source.dirIndexInboundLinkCount ?? null,
		protocol: source.protocol ?? null,
		hostname: source.hostname ?? null,
		path1: source.path1 ?? null,
		path2: source.path2 ?? null,
		path3: source.path3 ?? null,
		path4: source.path4 ?? null,
		path5: source.path5 ?? null,
		path6: source.path6 ?? null,
		path7: source.path7 ?? null,
		path8: source.path8 ?? null,
		path9: source.path9 ?? null,
		path10: source.path10 ?? null,
		isRedirectSource,
		redirectDestUrl: row.redirectDestUrl ?? null,
	};
}
