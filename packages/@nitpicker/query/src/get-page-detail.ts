import type { PageDetail } from './types.js';
import type { ArchiveAccessor, JsonLdRow, TagRow } from '@nitpicker/crawler';

import { decodeJsonRef, loadResponseHeadersBySetIds } from '@nitpicker/crawler';

import { dedupeCapShapeKeySelectColumn } from './dedupe-cap-shape-key-select-column.js';
import { getPageConsoleLogs } from './get-page-console-logs.js';
import { hasDedupeCapEventIdColumn } from './has-dedupe-cap-event-id-column.js';
import { hasPageTemplatesTable, templateKeySelectColumn } from './page-templates-join.js';
import { requireAliasOfIdColumn } from './require-alias-of-id-column.js';
import { resolveAliasAndRedirectChain } from './resolve-alias-and-redirect-chain.js';

/**
 * Summarises JSON-LD rows for the page-detail response.
 * @param rows - The page's `page_jsonld` rows.
 */
function summarizeJsonLdRows(rows: readonly JsonLdRow[]): PageDetail['jsonLd'] {
	const types = new Set<string>();
	let parseErrorCount = 0;
	for (const row of rows) {
		types.add(row.type ?? '(unknown)');
		if (row.parseError !== null) parseErrorCount++;
	}
	return {
		count: rows.length,
		types: [...types].toSorted(),
		parseErrorCount,
	};
}

/**
 * Summarises tag rows for the page-detail response.
 * @param rows - The page's `page_tags` rows.
 */
function summarizeTagRows(rows: readonly TagRow[]): PageDetail['tags'] {
	const providerIds: Record<string, Set<string>> = {};
	for (const row of rows) {
		if (!(row.provider in providerIds)) {
			providerIds[row.provider] = new Set<string>();
		}
		if (row.externalId !== null) {
			providerIds[row.provider]!.add(row.externalId);
		}
	}
	const sorted: Record<string, readonly string[]> = {};
	for (const provider of Object.keys(providerIds).toSorted()) {
		sorted[provider] = [...providerIds[provider]!].toSorted();
	}
	return { count: rows.length, providerIds: sorted };
}

/**
 * Retrieves detailed information about a single page by URL.
 *
 * 0.13: reads 0.13 entity tables (`content_items` + `page_meta`
 * + all ref tables). Response headers are reconstructed from
 * `header_sets` + `header_set_entries` + `header_name_refs` +
 * `header_value_refs`. `meta_extras` is decoded from `json_refs` (zstd or
 * uncompressed).
 *
 * A `url` naming either an HTTP-redirect source (`content_items.redirect_dest_id`)
 * or a URL-normalization alias (`content_items.alias_of_id`) resolves to its
 * final destination's / representative's detail, via
 * `resolveAliasAndRedirectChain` — "look up, then follow to the canonical
 * row," walked one hop at a time rather than read once, because a redirect's
 * destination row can itself turn out to be a non-representative alias
 * member of a *different* group (`backfillAliasOfId`'s candidate selection
 * excludes redirect *sources* from alias grouping, not redirect
 * destinations. These two are genuinely different relationships (one is
 * an observed HTTP 3xx, the other is a same-body/URL-shape inference with no
 * server-side redirect involved) but both collapse to "this URL's real page
 * is that other row" for the caller's purposes.
 *
 * `isDedupeCapped`/`dedupeCapShapeKey` degrade to `false`/`null` on an
 * archive that predates the `--dedupe-cap` post-hoc marking feature (no
 * `content_items.dedupe_cap_event_id` column) — see
 * `hasDedupeCapEventIdColumn`.
 * @param accessor - The archive accessor to query.
 * @param url - The URL of the page to retrieve.
 * @returns Detailed page information, or null if the page is not found.
 * @throws {Error} If `content_items.alias_of_id` does not exist on this
 *   connection (see `requireAliasOfIdColumn`).
 * @example
 * const detail = await getPageDetail(accessor, 'https://example.com/');
 * if (detail) {
 *   console.log(detail.title, detail.status, detail.outboundLinks.length);
 * }
 */
export async function getPageDetail(
	accessor: ArchiveAccessor,
	url: string,
): Promise<PageDetail | null> {
	const knex = accessor.getKnex();
	await requireAliasOfIdColumn(knex);
	const hasPageTemplates = await hasPageTemplatesTable(knex);
	const hasDedupeCapColumn = await hasDedupeCapEventIdColumn(knex);

	const candidate = await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.select('ci.id as id')
		.where('ur.url', url)
		.first();
	if (!candidate) {
		return null;
	}
	const targetId = await resolveAliasAndRedirectChain(knex, candidate.id);

	let query = knex('content_items as ci')
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
		.leftJoin('json_refs as extras_ref', 'extras_ref.id', 'pm.meta_extras_json_id');
	if (hasPageTemplates) {
		query = query.leftJoin('page_templates as pt', 'pt.page_id', 'ci.id');
	}
	if (hasDedupeCapColumn) {
		query = query.leftJoin(
			'dedupe_cap_events as dce',
			'dce.id',
			'ci.dedupe_cap_event_id',
		);
	}
	const [page] = await query
		.select(
			'ci.id as id',
			'ur.url as url',
			'ci.status as status',
			'ci.status_text as statusText',
			'ctr.raw as contentType',
			'ci.content_length as contentLength',
			'ci.is_external as isExternal',
			'ci.is_skipped as isSkipped',
			'ci.skip_reason as skipReason',
			'ci.header_set_id as headerSetId',
			'ci.first_crawled_at as firstCrawledAt',
			'ci.last_crawled_at as lastCrawledAt',
			'title_ref.text as title',
			'description_ref.text as description',
			'keywords_ref.text as keywords',
			'robots_raw_ref.text as robots_raw',
			'og_title_ref.text as og_title',
			'og_description_ref.text as og_description',
			'twitter_title_ref.text as twitter_title',
			'twitter_description_ref.text as twitter_description',
			'canonical_ur.url as canonical',
			'amphtml_ur.url as amphtml',
			'manifest_ur.url as manifest',
			'icon_ur.url as icon_href',
			'apple_ur.url as appleTouchIcon_href',
			'og_url_ur.url as og_url',
			'og_image_ur.url as og_image',
			'twitter_image_ur.url as twitter_image',
			'extras_ref.json_text as extras_body',
			'extras_ref.codec as extras_codec',
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
			'pm.robots_noindex as robots_noindex',
			'pm.robots_nofollow as robots_nofollow',
			'pm.robots_noarchive as robots_noarchive',
			'pm.robots_noimageindex as robots_noimageindex',
			'pm.googlebot as googlebot',
			'pm.og_type as og_type',
			'pm.og_site_name as og_site_name',
			'pm.og_image_alt as og_image_alt',
			'pm.og_image_width as og_image_width',
			'pm.og_image_height as og_image_height',
			'pm.og_locale as og_locale',
			'pm.og_article_published_time as og_article_published_time',
			'pm.og_article_modified_time as og_article_modified_time',
			'pm.twitter_card as twitter_card',
			'pm.twitter_site as twitter_site',
			'pm.twitter_creator as twitter_creator',
			'pm.fb_app_id as fb_app_id',
			'pm.verification_google as verification_google',
			'pm.format_detection_telephone as formatDetection_telephone',
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
			templateKeySelectColumn(knex, hasPageTemplates),
			dedupeCapShapeKeySelectColumn(knex, hasDedupeCapColumn),
		)
		.where('ci.id', targetId)
		.limit(1);
	if (!page) {
		return null;
	}

	// Reconstruct responseHeaders via the crawler's shared header loader so
	// the detail view always agrees with the crawler's own read paths on
	// how a given `header_set_id` merges back into a flat record.
	let responseHeaders: Record<string, string> = {};
	if (page.headerSetId != null) {
		const headersBySetId = await loadResponseHeadersBySetIds(knex, [page.headerSetId]);
		responseHeaders = headersBySetId.get(page.headerSetId) ?? {};
	}

	// Decode meta_extras via the crawler's shared json_refs decoder.
	// Corrupt bodies fail closed to `{}` with a warning, matching the
	// pre-0.13 try/catch shape.
	let metaExtras: Record<string, unknown> = {};
	if (page.extras_body != null) {
		const jsonText = decodeJsonRef(page.extras_body, page.extras_codec);
		if (jsonText === null) {
			// eslint-disable-next-line no-console -- surfaces DB data-integrity issues
			console.warn(`Failed to decode meta_extras for ${url}`);
		} else {
			try {
				const parsed: unknown = JSON.parse(jsonText);
				if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
					metaExtras = parsed as Record<string, unknown>;
				}
			} catch (error) {
				// eslint-disable-next-line no-console -- surfaces DB data-integrity issues
				console.warn(`Failed to decode meta_extras for ${url}:`, error);
			}
		}
	}

	const outboundRows = await knex('anchor_edges as ae')
		.select(
			'dest_ur.url as url',
			'text_ref.text as textContent',
			'dest.status as status',
			'dest.is_external as isExternal',
		)
		.join('content_items as dest', 'ae.href_page_id', 'dest.id')
		.join('url_refs as dest_ur', 'dest_ur.id', 'dest.url_id')
		.leftJoin('text_refs as text_ref', 'text_ref.id', 'ae.first_text_id')
		.where('ae.page_id', page.id);

	const outboundLinks = outboundRows.map(
		(row: {
			url: string;
			textContent: string | null;
			status: number | null;
			isExternal: 0 | 1;
		}) => ({
			url: row.url,
			textContent: row.textContent,
			status: row.status,
			isExternal: !!row.isExternal,
		}),
	);

	const redirectRows = await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.select('ur.url as url')
		.where('ci.redirect_dest_id', page.id);

	const redirectFrom = redirectRows.map((row: { url: string }) => row.url);

	const aliasRows = await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.select('ur.url as url')
		.where('ci.alias_of_id', page.id);

	const aliasUrls = aliasRows.map((row: { url: string }) => row.url);

	const [jsonLdRows, tagRows, consoleLogs] = await Promise.all([
		accessor.getJsonLdOfPage(page.id),
		accessor.getTagsOfPage(page.id),
		getPageConsoleLogs(accessor, page.url),
	]);

	return {
		url: page.url,
		status: page.status,
		statusText: page.statusText,
		contentType: page.contentType,
		contentLength: page.contentLength,
		isExternal: !!page.isExternal,
		isSkipped: !!page.isSkipped,
		skipReason: page.skipReason,
		isDedupeCapped: page.dedupeCapShapeKey != null,
		dedupeCapShapeKey: page.dedupeCapShapeKey,
		title: page.title,
		description: page.description,
		keywords: page.keywords,
		lang: page.lang,
		dir: page.dir,
		charset: page.charset,
		baseHref: page.baseHref,
		viewportRaw: page.viewport_raw,
		themeColor: page.themeColor,
		applicationName: page.applicationName,
		author: page.author,
		generator: page.generator,
		publisher: page.publisher,
		robotsRaw: page.robots_raw,
		noindex: !!page.robots_noindex,
		nofollow: !!page.robots_nofollow,
		noarchive: !!page.robots_noarchive,
		noimageindex: !!page.robots_noimageindex,
		googlebot: page.googlebot,
		canonical: page.canonical,
		amphtml: page.amphtml,
		manifest: page.manifest,
		iconHref: page.icon_href,
		appleTouchIconHref: page.appleTouchIcon_href,
		ogType: page.og_type,
		ogTitle: page.og_title,
		ogUrl: page.og_url,
		ogSiteName: page.og_site_name,
		ogDescription: page.og_description,
		ogImage: page.og_image,
		ogImageAlt: page.og_image_alt,
		ogImageWidth: page.og_image_width,
		ogImageHeight: page.og_image_height,
		ogLocale: page.og_locale,
		ogArticlePublishedTime: page.og_article_published_time,
		ogArticleModifiedTime: page.og_article_modified_time,
		twitterCard: page.twitter_card,
		twitterSite: page.twitter_site,
		twitterCreator: page.twitter_creator,
		twitterTitle: page.twitter_title,
		twitterDescription: page.twitter_description,
		twitterImage: page.twitter_image,
		fbAppId: page.fb_app_id,
		verificationGoogle: page.verification_google,
		formatDetectionTelephone:
			page.formatDetection_telephone === null
				? null
				: page.formatDetection_telephone === 1,
		firstCrawledAt: page.firstCrawledAt,
		lastCrawledAt: page.lastCrawledAt,
		tagCount: page.tag_count,
		jsonldCount: page.jsonld_count,
		tagsProvidersCsv: page.tags_providers_csv,
		mainContentNodeName: page.main_content_node_name,
		mainContentId: page.main_content_id,
		mainContentRole: page.main_content_role,
		mainContentSelector: page.main_content_selector,
		mainContentClassList:
			page.main_content_class_list === null
				? null
				: (JSON.parse(page.main_content_class_list) as string[]),
		mainContentWordCount: page.main_content_word_count,
		mainContentBodyWordCount: page.main_content_body_word_count,
		mainContentHeadingCount: page.main_content_heading_count,
		mainContentImageCount: page.main_content_image_count,
		mainContentTableCount: page.main_content_table_count,
		mainContentButtonCount: page.main_content_button_count,
		mainContentIframeCount: page.main_content_iframe_count,
		mainContentVideoCount: page.main_content_video_count,
		mainContentAudioCount: page.main_content_audio_count,
		mainContentCanvasCount: page.main_content_canvas_count,
		scrollHeightDesktop: page.scroll_height_desktop,
		scrollHeightMobile: page.scroll_height_mobile,
		templateKey: page.templateKey,
		metaExtras,
		jsonLd: summarizeJsonLdRows(jsonLdRows),
		tags: summarizeTagRows(tagRows),
		responseHeaders,
		outboundLinks,
		redirectFrom,
		aliasUrls,
		consoleLogs,
	};
}
