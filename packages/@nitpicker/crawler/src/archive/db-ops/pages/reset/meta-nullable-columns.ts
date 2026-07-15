/**
 * Columns of the `pages` table that should be reset to `null` whenever a
 * previously-scraped row is demoted back to "pending" (i.e. by
 * `resetFailedPages` and `repromoteExternalPages`).
 *
 * Includes all flat meta columns, the denormalised aggregates, and the
 * `meta_extras` JSON catch-all. **Excludes** `firstCrawledAt` / `lastCrawledAt`
 * by design — failure reset must not erase the last-success timestamp, which
 * is the within-archive observation axis for #11 / #17 / #19 use cases.
 *
 * Centralised in one constant so schema growth and reset logic stay in lock-
 * step: adding a flat meta column without updating this list would leave
 * stale data after a reset.
 */
export const META_NULLABLE_COLUMNS: readonly string[] = [
	// Document basics
	'lang',
	'dir',
	'charset',
	'baseHref',
	'viewport_raw',
	'themeColor',
	'applicationName',
	'author',
	'generator',
	'publisher',
	// Title / description / keywords
	'title',
	'description',
	'keywords',
	// Robots
	'robots_raw',
	'robots_noindex',
	'robots_nofollow',
	'robots_noarchive',
	'robots_noimageindex',
	'googlebot',
	// Link (1:1)
	'canonical',
	'amphtml',
	'manifest',
	'icon_href',
	'appleTouchIcon_href',
	// Open Graph
	'og_type',
	'og_title',
	'og_url',
	'og_site_name',
	'og_description',
	'og_image',
	'og_image_alt',
	'og_image_width',
	'og_image_height',
	'og_locale',
	'og_article_published_time',
	'og_article_modified_time',
	// Twitter
	'twitter_card',
	'twitter_site',
	'twitter_creator',
	'twitter_title',
	'twitter_description',
	'twitter_image',
	// One-offs
	'fb_app_id',
	'verification_google',
	'formatDetection_telephone',
	// Denormalised aggregates
	'tag_count',
	'jsonld_count',
	'tags_providers_csv',
	// Catch-all
	'meta_extras',
];
