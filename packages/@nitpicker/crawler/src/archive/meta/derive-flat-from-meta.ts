import type { FlatPageMetaColumns } from './types.js';
import type { Meta } from '@d-zero/beholder';

/**
 * Derives the {@link FlatPageMetaColumns} (`pages` table flat columns) from a
 * beholder {@link Meta} object.
 *
 * Handles three concerns the database layer should not re-implement:
 *
 * 1. **Null-safe traversal** of the new nested Meta shape
 *    (`meta.og?.title`, `meta.robots?.noindex`, `meta.link?.canonical`, etc.).
 *    All optional sub-objects are guarded so an absent meta tag becomes
 *    `null` rather than a runtime crash.
 *
 * 2. **URL absolutisation** for every URL-shaped column. beholder 3.0.0
 *    extracts link/og href values via `link.getAttribute('href')`, which
 *    preserves relative URLs as-written. `find-mismatches` compares
 *    `canonical != url` directly, so we must resolve everything against the
 *    page URL (or `<base href>` if present) before persistence. Malformed
 *    URLs become `null` rather than blowing up the entire insert.
 *
 * 3. **Boolean → integer coercion** for SQLite-style boolean columns
 *    (`robots_*`, `formatDetection_telephone`). `undefined` and unparseable
 *    values map to `null`.
 *
 * URL-shaped columns: `canonical`, `og_url`, `og_image`, `amphtml`,
 * `manifest`, `icon_href`, `appleTouchIcon_href`, `twitter_image`.
 * @param meta - Beholder-derived metadata for the page.
 * @param pageUrl - Absolute URL of the page being persisted. Used as the
 *   fallback base when `meta.baseHref` is absent or relative.
 * @returns A flat object whose keys map 1:1 to `pages` table columns.
 * @example
 * deriveFlatFromMeta(meta, 'https://example.com/about')
 *   // → { canonical: 'https://example.com/about', og_title: '...', ... }
 */
export function deriveFlatFromMeta(meta: Meta, pageUrl: string): FlatPageMetaColumns {
	const base = resolveBase(meta.baseHref, pageUrl);
	const robots = meta.robots;
	const og = meta.og;
	const ogArticle = og?.article;
	const twitter = meta.twitter;
	const link = meta.link;
	const formatDetection = meta.formatDetection;
	return {
		// Document basics
		lang: nullableString(meta.lang),
		dir: nullableString(meta.dir),
		charset: nullableString(meta.charset),
		baseHref: absolutizeUrl(meta.baseHref, pageUrl),
		viewport_raw: nullableString(meta.viewport?.raw),
		themeColor: nullableString(meta.themeColor),
		applicationName: nullableString(meta.applicationName),
		author: nullableString(meta.author),
		generator: nullableString(meta.generator),
		publisher: nullableString(meta.publisher),

		// Robots
		robots_raw: nullableString(robots?.raw),
		robots_noindex: booleanToInt(robots?.noindex),
		robots_nofollow: booleanToInt(robots?.nofollow),
		robots_noarchive: booleanToInt(robots?.noarchive),
		robots_noimageindex: booleanToInt(robots?.noimageindex),
		googlebot: nullableString(meta.googlebot),

		// Link (1:1 only)
		canonical: absolutizeUrl(link?.canonical, base),
		amphtml: absolutizeUrl(link?.amphtml, base),
		manifest: absolutizeUrl(link?.manifest, base),
		icon_href: absolutizeUrl(link?.icon?.href, base),
		appleTouchIcon_href: absolutizeUrl(link?.appleTouchIcon?.href, base),

		// Open Graph
		og_type: nullableString(og?.type),
		og_title: nullableString(og?.title),
		og_url: absolutizeUrl(og?.url, base),
		og_site_name: nullableString(og?.siteName),
		og_description: nullableString(og?.description),
		og_image: absolutizeUrl(og?.imageUrl ?? og?.image?.[0], base),
		og_image_alt: nullableString(og?.imageAlt),
		og_image_width: nullableString(og?.imageWidth),
		og_image_height: nullableString(og?.imageHeight),
		og_locale: nullableString(og?.locale),
		og_article_published_time: nullableString(ogArticle?.publishedTime),
		og_article_modified_time: nullableString(ogArticle?.modifiedTime),

		// Twitter
		twitter_card: nullableString(twitter?.card),
		twitter_site: nullableString(twitter?.site),
		twitter_creator: nullableString(twitter?.creator),
		twitter_title: nullableString(twitter?.title),
		twitter_description: nullableString(twitter?.description),
		twitter_image: absolutizeUrl(twitter?.image ?? twitter?.imageSrc, base),

		// One-offs
		fb_app_id: nullableString(meta.fb?.appId),
		verification_google: nullableString(meta.verification?.google),
		formatDetection_telephone: booleanToInt(formatDetection?.telephone),

		// Title / description / keywords (top-level Meta fields)
		title: nullableString(meta.title),
		description: nullableString(meta.description),
		keywords: nullableString(meta.keywords),
	};
}

/**
 * Resolves the effective base URL for relative-URL absolutisation.
 *
 * Falls back to `pageUrl` when `baseHref` is absent. When `baseHref` itself
 * is a relative URL (rare but spec-permitted), resolves it against
 * `pageUrl` first so subsequent `new URL(value, base)` calls see an
 * absolute base.
 * @param baseHref
 * @param pageUrl
 */
function resolveBase(baseHref: string | undefined, pageUrl: string): string {
	if (!baseHref) return pageUrl;
	try {
		return new URL(baseHref, pageUrl).href;
	} catch {
		return pageUrl;
	}
}

/**
 * Resolves a possibly-relative URL against a base.
 *
 * Returns `null` for `undefined` / empty string / unparseable input so a
 * malformed page does not abort the entire `#insertPage` call.
 * @param value
 * @param base
 */
function absolutizeUrl(value: string | undefined | null, base: string): string | null {
	if (value === undefined || value === null || value === '') return null;
	try {
		return new URL(value, base).href;
	} catch {
		return null;
	}
}

/**
 * Normalises optional / empty strings to `null` so SQL `IS NULL` queries
 * behave consistently. Trim is intentional — leading/trailing whitespace in
 * `<meta content=>` is meaningless for downstream consumers.
 * @param value
 */
function nullableString(value: string | undefined | null): string | null {
	if (value === undefined || value === null) return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

/**
 * Converts an optional boolean to SQLite's 0/1 integer representation. Any
 * non-boolean (`undefined`, non-boolean string from `boolean-true` keys)
 * becomes `null`.
 * @param value
 */
function booleanToInt(value: boolean | string | undefined | null): number | null {
	if (value === true) return 1;
	if (value === false) return 0;
	return null;
}
