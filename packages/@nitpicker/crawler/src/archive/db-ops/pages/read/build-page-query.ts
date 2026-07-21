import type { Knex } from 'knex';

/**
 * Builds a `content_items` query joined against `page_meta` and every ref
 * table needed to reconstruct a flat, legacy-shaped page row. Selected
 * columns are aliased to the `DB_Page` field names; `responseHeaders` and
 * `meta_extras` are NOT reconstructed here (they need a second, batched
 * pass — see {@link ../read/reconstruct-page-rows.js}) so this query stays
 * a single-pass join with no N+1 subqueries. `headerSetId` and the
 * `extras_body` / `extras_codec` pair are selected as intermediates for
 * that second pass.
 * @param knex - Knex query builder connected to the archive DB.
 * @returns A query builder pre-configured with every join `get-pages.ts` /
 *   `get-pages-with-rels.ts` need; callers add `.where()` / `.limit()` /
 *   `.offset()` on top.
 * @example
 * const rows = await buildPageQuery(knex).where('ci.is_target', 1);
 */
export function buildPageQuery(knex: Knex): Knex.QueryBuilder {
	return knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
		.leftJoin('page_meta as pm', 'pm.page_id', 'ci.id')
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
		.leftJoin(
			'text_refs as twitter_title_ref',
			'twitter_title_ref.id',
			'pm.twitter_title_text_id',
		)
		.leftJoin(
			'text_refs as twitter_description_ref',
			'twitter_description_ref.id',
			'pm.twitter_description_text_id',
		)
		.leftJoin('url_refs as canonical_ur', 'canonical_ur.id', 'pm.canonical_url_id')
		.leftJoin('url_refs as amphtml_ur', 'amphtml_ur.id', 'pm.amphtml_url_id')
		.leftJoin('url_refs as manifest_ur', 'manifest_ur.id', 'pm.manifest_url_id')
		.leftJoin('url_refs as icon_ur', 'icon_ur.id', 'pm.icon_url_id')
		.leftJoin('url_refs as apple_ur', 'apple_ur.id', 'pm.apple_touch_icon_url_id')
		.leftJoin('url_refs as og_url_ur', 'og_url_ur.id', 'pm.og_url_id')
		.leftJoin('url_refs as og_image_ur', 'og_image_ur.id', 'pm.og_image_url_id')
		.leftJoin(
			'url_refs as twitter_image_ur',
			'twitter_image_ur.id',
			'pm.twitter_image_url_id',
		)
		.leftJoin('json_refs as extras_ref', 'extras_ref.id', 'pm.meta_extras_json_id')
		.select(
			'ci.id as id',
			'ur.url as url',
			'ci.redirect_dest_id as redirectDestId',
			'ci.scraped as scraped',
			'ci.is_target as isTarget',
			'ci.is_external as isExternal',
			'ci.status as status',
			'ci.status_text as statusText',
			'ctr.raw as contentType',
			'ci.content_length as contentLength',
			'ci.header_set_id as headerSetId',
			'pm.lang as lang',
			'pm.dir as dir',
			'pm.charset as charset',
			'pm.base_href as baseHref',
			'pm.viewport_raw as viewport_raw',
			'pm.theme_color as themeColor',
			'pm.application_name as applicationName',
			'pm.author as author',
			'pm.generator as generator',
			'pm.publisher as publisher',
			'title_ref.text as title',
			'description_ref.text as description',
			'keywords_ref.text as keywords',
			'robots_raw_ref.text as robots_raw',
			'pm.robots_noindex as robots_noindex',
			'pm.robots_nofollow as robots_nofollow',
			'pm.robots_noarchive as robots_noarchive',
			'pm.robots_noimageindex as robots_noimageindex',
			'pm.googlebot as googlebot',
			'canonical_ur.url as canonical',
			'amphtml_ur.url as amphtml',
			'manifest_ur.url as manifest',
			'icon_ur.url as icon_href',
			'apple_ur.url as appleTouchIcon_href',
			'pm.og_type as og_type',
			'og_title_ref.text as og_title',
			'og_url_ur.url as og_url',
			'pm.og_site_name as og_site_name',
			'og_description_ref.text as og_description',
			'og_image_ur.url as og_image',
			'pm.og_image_alt as og_image_alt',
			'pm.og_image_width as og_image_width',
			'pm.og_image_height as og_image_height',
			'pm.og_locale as og_locale',
			'pm.og_article_published_time as og_article_published_time',
			'pm.og_article_modified_time as og_article_modified_time',
			'pm.twitter_card as twitter_card',
			'pm.twitter_site as twitter_site',
			'pm.twitter_creator as twitter_creator',
			'twitter_title_ref.text as twitter_title',
			'twitter_description_ref.text as twitter_description',
			'twitter_image_ur.url as twitter_image',
			'pm.fb_app_id as fb_app_id',
			'pm.verification_google as verification_google',
			'pm.format_detection_telephone as formatDetection_telephone',
			'ci.first_crawled_at as firstCrawledAt',
			'ci.last_crawled_at as lastCrawledAt',
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
			'pm.scroll_height_desktop as scroll_height_desktop',
			'pm.scroll_height_mobile as scroll_height_mobile',
			'extras_ref.json_text as extras_body',
			'extras_ref.codec as extras_codec',
			'ci.is_skipped as isSkipped',
			'ci.skip_reason as skipReason',
			'ci.crawl_order as order',
			'ci.source as source',
		);
}
