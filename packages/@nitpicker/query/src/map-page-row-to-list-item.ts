import type { PageListItem, PageListRow } from './types.js';

/**
 * Legacy column-name list retained for pre-Phase-6 fallback callers (kept as
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
 * All three page-list queries (`listPages`, `listPagesByTag`,
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
	'ci.first_crawled_at as firstCrawledAt',
	'ci.last_crawled_at as lastCrawledAt',
];

/**
 * Projects a {@link PageListRow} (raw SQL row) into the public
 * {@link PageListItem} DTO. Camel-cases column names, converts SQLite
 * 0/1 integers to booleans, and surfaces the denormalised aggregates as-is.
 *
 * Used by `listPages`, `listPagesByTag`, and `listPagesByJsonLdType` so the
 * three SQL paths produce an identical DTO shape.
 * @param row - One SQL row with the {@link PAGE_LIST_COLUMNS} columns.
 */
export function mapPageRowToListItem(row: PageListRow): PageListItem {
	return {
		url: row.url,
		title: row.title,
		status: row.status,
		contentType: row.contentType,
		isExternal: !!row.isExternal,
		hasDescription: row.description != null && row.description !== '',
		hasOgTitle: row.og_title != null && row.og_title !== '',
		noindex: !!row.robots_noindex,
		description: row.description,
		keywords: row.keywords,
		lang: row.lang,
		nofollow: !!row.robots_nofollow,
		noarchive: !!row.robots_noarchive,
		robotsRaw: row.robots_raw,
		canonical: row.canonical,
		ogType: row.og_type,
		ogTitle: row.og_title,
		ogSiteName: row.og_site_name,
		ogDescription: row.og_description,
		ogUrl: row.og_url,
		ogImage: row.og_image,
		ogImageAlt: row.og_image_alt,
		ogLocale: row.og_locale,
		ogArticlePublishedTime: row.og_article_published_time,
		twitterCard: row.twitter_card,
		twitterSite: row.twitter_site,
		twitterCreator: row.twitter_creator,
		twitterImage: row.twitter_image,
		charset: row.charset,
		themeColor: row.themeColor,
		manifest: row.manifest,
		tagCount: row.tag_count,
		jsonldCount: row.jsonld_count,
		tagsProvidersCsv: row.tags_providers_csv,
		firstCrawledAt: row.firstCrawledAt,
		lastCrawledAt: row.lastCrawledAt,
		hasCSP: !!row.hasCSP,
		hasXFrameOptions: !!row.hasXFrameOptions,
		hasXContentTypeOptions: !!row.hasXContentTypeOptions,
		hasHSTS: !!row.hasHSTS,
	};
}
