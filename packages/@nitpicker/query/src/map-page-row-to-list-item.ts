import type { PageListItem, PageListRow } from './types.js';

/**
 * SQL column list shared by the three "list pages" queries
 * (`listPages`, `listPagesByTag`, `listPagesByJsonLdType`). Kept in lock-step
 * with {@link PageListRow} — adding a column means updating both.
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
	};
}
