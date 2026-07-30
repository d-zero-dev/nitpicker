import type { DomPathCandidate } from './populate-entity-tables/types.js';
import type { PageData } from '../utils/types/types.js';
import type { ParseURLOptions } from '@d-zero/shared/parse-url';

/**
 * A scraped page payload optionally enriched with the in-browser
 * dom-path capture (`crawler/capture-image-dom-paths.ts`): every `<img>`
 * of the rendered document as `{ outerHTML, path }` pairs in document
 * order. The write path matches these against `imageList[].sourceCode`
 * to resolve `image_items.dom_path_text_id`; when absent (capture
 * failed, metadata-only scrape, or a caller that never renders), every
 * image falls back to the synthetic `unknown/<n>` marker.
 */
export type PageDataWithDomPaths = PageData & {
	/** In-browser dom-path capture for the rendered document's images. */
	imageDomPaths?: readonly DomPathCandidate[];
};

/**
 * Event map for database-related events emitted by the Database and ArchiveAccessor classes.
 * @example
 * archive.on('error', (error) => {
 *   console.error('database failure:', error.message);
 * });
 */
export interface DatabaseEvent {
	/** An error that occurred during a database operation. */
	error: Error;
}

/**
 * Configuration stored in the archive database's `info` table.
 * Represents all crawling options that were used for the crawl session.
 * @example
 * const config = await archive.getConfig();
 * console.log(config.roots, config.userAgent, config.parallels);
 */
export interface Config extends Required<Pick<ParseURLOptions, 'disableQueries'>> {
	/** The starting URL for the crawl. Stored as a denormalised mirror of `roots[0]` so summary consumers can read a single URL without parsing the array. */
	baseUrl: string;
	/** The user-provided root URLs that seeded the crawl. Each root is both a recursive starting point and a scope entry. Always non-empty. */
	roots: string[];
	/** Maximum directory depth for excluded paths. */
	maxExcludedDepth: number;
	/** Keywords used to exclude pages from crawling. */
	excludeKeywords: string[];
	/** URL patterns to exclude from crawling. */
	excludes: string[];
	/** URL prefixes to exclude from crawling. */
	excludeUrls: string[];
	/** Whether to fetch external (off-site) pages. */
	fetchExternal: boolean;
	/** Whether the crawl was initiated from a URL list rather than recursive discovery. */
	fromList: boolean;
	/** Whether to collect image data during crawling. */
	image: boolean;
	/** Interval in milliseconds between requests. */
	interval: number;
	/** The name identifier for this crawl session. */
	name: string;
	/** Number of parallel crawling processes. */
	parallels: number;
	/** Whether to recursively follow links. */
	recursive: boolean;
	/** Maximum number of retry attempts per URL on scrape failure. */
	retry: number;
	/** The version of Nitpicker that created this archive. */
	version: string;

	/** User-Agent string used for HTTP requests. */
	userAgent: string;

	/** Whether robots.txt restrictions were ignored during crawling. */
	ignoreRobots: boolean;

	/**
	 * CSS selector overriding beholder's automatic main-content-region
	 * detection, or `null`/omitted to use the automatic heuristic.
	 */
	mainContentSelector?: string | null;
}

/**
 * Provenance of a page or resource row — which crawler channel originally
 * inserted it. Stored as `content_items.source` / `resource_items.source`
 * in the SQLite schema (NOT NULL DEFAULT `'crawled'`).
 *
 * - `'crawled'` — discovered via the recursive crawl rooted at `info.roots`.
 *   Default for rows that predate the `--inventory` feature.
 * - `'inventory-seed'` — supplied directly by a `crawl --inventory` URL
 *   list. For pages this is the HTML URL that was rendered; for resources
 *   this is a non-HTML URL handed in by the list (HEAD-fetched without
 *   rendering).
 * - `'inventory-discovered'` — found by following links from an
 *   `inventory-seed` page, OR (for resources) loaded by puppeteer while
 *   rendering one of those pages.
 *
 * Used by the viewer as a badge and to indicate why a row was added.
 * Isolation queries (`listIsolatedPages` / `listUnusedResources`) judge
 * orphans by `referrer = 0`, NOT by this value — `source` only labels
 * the row.
 * @example
 * if (page.source !== 'crawled') {
 *   // Row was introduced by a `crawl --inventory` pass.
 * }
 */
export type PageSource = 'crawled' | 'inventory-seed' | 'inventory-discovered';

/**
 * One row written to the `inventory_runs` audit table on each successful
 * `--inventory <list>` invocation.
 *
 * Schema-mirror interface: every column on `inventory_runs` is represented
 * here. Only `ran_at` is required — every other field is nullable so a
 * raw-SQL backfill (a one-off `sqlite3 INSERT` recording an inventory
 * pass that predates this table) can omit summary
 * stats it cannot reconstruct.
 *
 * The audit log is append-only: there is intentionally no UPDATE path,
 * no UNIQUE constraint on `source_file_sha256`, and no FK to pages /
 * resources — re-applying the same list yields a second row. Duplicate
 * detection is a read-side concern; `source_file_sha256` is recorded as
 * the content-identity key it would use.
 * @example
 * await archive.recordInventoryRun({
 *   ran_at: new Date().toISOString(),
 *   list_label: 'prod-2026-06',
 *   total_lines: 113_268,
 *   new_pages: 1234,
 *   new_resources: 56,
 *   scope_skipped: 7,
 * });
 */
export interface InventoryRunMeta {
	/** ISO 8601 timestamp at which the run completed (e.g. `'2026-06-21T11:30:00+09:00'`). */
	ran_at: string;
	/** Human-readable identifier (e.g. `'prod-2026-06-21'`). `null` when the caller did not supply one. */
	list_label?: string | null;
	/** SHA-256 hex digest of the source file. `null` for programmatic callers that built the URL list in-memory (no source file to hash). */
	source_file_sha256?: string | null;
	/** Number of valid URLs in the input list, after the CLI has warned-and-dropped unparseable-URL lines but before scope filtering. */
	total_lines?: number | null;
	/** Number of new HTML seeds inserted as `content_items` rows by this run. */
	new_pages?: number | null;
	/** Number of new non-HTML URLs inserted as `resource_items` rows by this run. */
	new_resources?: number | null;
	/** Number of input URLs dropped because they fell outside the archived scope. */
	scope_skipped?: number | null;
	/** Number of source-file lines dropped by the CLI for failing URL validation, before this row's `total_lines` was counted. `null` for programmatic callers that built the URL list in-memory (no source file to have invalid lines). */
	invalid_skipped?: number | null;
	/** Free-form text for backfill annotations or operator notes. */
	notes?: string | null;
}

/**
 * A row in `network_outages` — one detected operator-network outage.
 *
 * Append-only except `ended_at`: it is written once, `NULL`, when the
 * outage is first detected, and updated exactly once when a recovery probe
 * succeeds. A row can also be left `ended_at = NULL` forever if the crawl
 * process is killed mid-outage — readers must resolve this via a clamp
 * (see `is-within-outage-window.ts` and the `db-ops/outages/` writer that
 * closes stale-open rows on the next writer session), never by treating
 * `NULL` as an unbounded window.
 */
export interface NetworkOutageRow {
	id: number;
	/** Epoch ms, backdated to the earliest error still inside the detector's sliding window at trigger time. */
	started_at: number;
	/** Epoch ms the sliding window actually crossed both thresholds. */
	detected_at: number;
	/** Epoch ms the recovery probe first succeeded, or `null` while still open / if the session crashed before recovery. */
	ended_at: number | null;
	/** Hostname the recovery probe targeted, or `null` if none was available (see `choose-probe-host.ts`). */
	probe_host: string | null;
	/** Error count in the detector's window at trigger time. */
	trigger_error_count: number;
	/** Distinct host count in the detector's window at trigger time. */
	trigger_host_count: number;
}

/**
 * Fields required to record a newly-detected outage via
 * `Database.insertNetworkOutage`. camelCase (unlike {@link NetworkOutageRow}
 * / {@link InventoryRunMeta}) because callers build this directly from
 * `NetworkOutageDetector`'s camelCase `OutageSuspect` plus a probe host —
 * the db-op does the camelCase → snake_case column mapping on write.
 */
export interface InsertNetworkOutageParams {
	/** Backdated to the earliest error still inside the detector's window at trigger time. */
	startedAt: number;
	/** When the sliding window actually crossed both thresholds. */
	detectedAt: number;
	/** Hostname the recovery probe will target, or `null` if none was available. */
	probeHost: string | null;
	triggerErrorCount: number;
	triggerHostCount: number;
}

/**
 * Fields required to record a newly-capped URL shape via
 * `Database.insertDedupeCapEvent`. camelCase, mapped to snake_case columns
 * on write — same convention as {@link InsertNetworkOutageParams}.
 */
export interface InsertDedupeCapEventParams {
	shapeKey: string;
	sampleUrl: string;
	bodyHash: Buffer;
	effectiveThreshold: number;
	observedCount: number;
	detectedAt: number;
}

/**
 * Filter type for querying pages from the database.
 *
 * - `'page'` - HTML pages that are crawl targets
 * - `'page-included-no-target'` - All HTML pages, including non-target pages
 * - `'external-page'` - HTML pages on external domains
 * - `'internal-page'` - HTML pages on the crawled domain
 * - `'no-page'` - Non-HTML resources (e.g., images, PDFs)
 * - `'external-no-page'` - External non-HTML resources
 * - `'internal-no-page'` - Internal non-HTML resources
 * @example
 * const internalHtmlPages = await accessor.getPages('internal-page');
 */
export type PageFilter =
	| 'page'
	| 'page-included-no-target'
	| 'external-page'
	| 'internal-page'
	| 'no-page'
	| 'external-no-page'
	| 'internal-no-page';

/**
 * Flat page-row shape.
 *
 * Serves two roles: (1) the read shape that
 * `db-ops/pages/read/reconstruct-page-rows.ts` rebuilds by joining the
 * entity / ref tables (`content_items` / `page_meta` / `url_refs` …), and
 * (2) the raw row shape of the pre-0.13 legacy `pages` table, which only
 * exists inside pre-0.13 input archives and is read by the 0.13 migration
 * populate code. Most meta fields are derived from beholder 3.0.0's nested
 * {@link import('@d-zero/beholder').Meta} via
 * `archive/meta/derive-flat-from-meta.ts` and are stored as plain scalars
 * for SQL-level filter / projection. The catch-all `meta_extras` JSON
 * column preserves nested sub-objects not flattened above.
 * @example
 * const pages = await accessor.getPages('page');
 * for (const page of pages) {
 *   console.log(page.url, page.status, page.title);
 * }
 */
export interface DB_Page {
	/** Auto-incremented primary key. */
	id: number;
	/** The canonical URL of the page. */
	url: string;
	/** Foreign key to the redirect destination page, or null if not redirected. */
	redirectDestId: number | null;
	/** Whether the page has been scraped (1) or is still pending (0). */
	scraped: 0 | 1;
	/** Whether the page is a crawl target (1) or discovered incidentally (0). */
	isTarget: 0 | 1;
	/** Whether the page is on an external domain (1) or internal (0). */
	isExternal: 0 | 1;
	/** HTTP response status code, or null if not yet fetched. */
	status: number | null;
	/** HTTP response status text (e.g., "OK", "Not Found"), or null if not yet fetched. */
	statusText: string | null;
	/** MIME content type of the response (e.g., "text/html"), or null if unknown. */
	contentType: string | null;
	/** Content length in bytes, or null if unknown. */
	contentLength: number | null;
	/** JSON-serialized HTTP response headers. */
	responseHeaders: string;

	// Document basics
	/** The `lang` attribute value from the HTML element, or null. */
	lang: string | null;
	/** The `dir` attribute value, or null. */
	dir: string | null;
	/** The `<meta charset>` value, or null. */
	charset: string | null;
	/** Absolutised `<base href>`, or null. */
	baseHref: string | null;
	/** The raw `<meta name="viewport">` content, or null. */
	viewport_raw: string | null;
	/** The primary `<meta name="theme-color">` (no media), or null. */
	themeColor: string | null;
	/** `<meta name="application-name">`, or null. */
	applicationName: string | null;
	/** `<meta name="author">`, or null. */
	author: string | null;
	/** `<meta name="generator">`, or null. */
	generator: string | null;
	/** `<meta name="publisher">`, or null. */
	publisher: string | null;

	// Title / description / keywords
	/** The page title from the `<title>` element, or null. */
	title: string | null;
	/** The meta description content, or null. */
	description: string | null;
	/** The meta keywords content, or null. */
	keywords: string | null;

	// Robots
	/** The raw `<meta name="robots">` content, or null. */
	robots_raw: string | null;
	/** Whether the noindex directive is set (SQLite INTEGER 0/1). */
	robots_noindex: number | null;
	/** Whether the nofollow directive is set (SQLite INTEGER 0/1). */
	robots_nofollow: number | null;
	/** Whether the noarchive directive is set (SQLite INTEGER 0/1). */
	robots_noarchive: number | null;
	/** Whether the noimageindex directive is set (SQLite INTEGER 0/1). */
	robots_noimageindex: number | null;
	/** `<meta name="googlebot">` content, or null. */
	googlebot: string | null;

	// Link (1:1 only — array shapes live in meta_extras)
	/** Absolutised `<link rel="canonical">` href, or null. */
	canonical: string | null;
	/** Absolutised `<link rel="amphtml">` href, or null. */
	amphtml: string | null;
	/** Absolutised `<link rel="manifest">` href, or null. */
	manifest: string | null;
	/** Absolutised `<link rel="icon">` href, or null. */
	icon_href: string | null;
	/** Absolutised `<link rel="apple-touch-icon">` href, or null. */
	appleTouchIcon_href: string | null;

	// Open Graph
	/** og:type, or null. */
	og_type: string | null;
	/** og:title, or null. */
	og_title: string | null;
	/** Absolutised og:url, or null. */
	og_url: string | null;
	/** og:site_name, or null. */
	og_site_name: string | null;
	/** og:description, or null. */
	og_description: string | null;
	/** Absolutised og:image (first if multiple), or null. */
	og_image: string | null;
	/** og:image:alt, or null. */
	og_image_alt: string | null;
	/** og:image:width as a string (per spec), or null. */
	og_image_width: string | null;
	/** og:image:height as a string (per spec), or null. */
	og_image_height: string | null;
	/** og:locale, or null. */
	og_locale: string | null;
	/** og:article:published_time, or null. */
	og_article_published_time: string | null;
	/** og:article:modified_time, or null. */
	og_article_modified_time: string | null;

	// Twitter
	/** twitter:card, or null. */
	twitter_card: string | null;
	/** twitter:site, or null. */
	twitter_site: string | null;
	/** twitter:creator, or null. */
	twitter_creator: string | null;
	/** twitter:title, or null. */
	twitter_title: string | null;
	/** twitter:description, or null. */
	twitter_description: string | null;
	/** Absolutised twitter:image (or twitter:image:src fallback), or null. */
	twitter_image: string | null;

	// One-offs
	/** Facebook app id (`fb:app_id`), or null. */
	fb_app_id: string | null;
	/** Google site verification token, or null. */
	verification_google: string | null;
	/** `format-detection` telephone (SQLite INTEGER 0/1), or null. */
	formatDetection_telephone: number | null;

	// Within-archive observation timestamps (UNIX ms)
	/** First time this page row was inserted (UNIX ms), or null on legacy rows. */
	firstCrawledAt: number | null;
	/** Last successful re-scrape time (UNIX ms), or null on legacy rows. */
	lastCrawledAt: number | null;

	// Denormalised aggregates (written by archive/meta/compute-page-denormalized)
	/** Number of `page_tags` rows belonging to this page. */
	tag_count: number | null;
	/** `meta.jsonLd.length + meta.speculationRules.length` at scrape time. */
	jsonld_count: number | null;
	/** Sorted unique provider names, comma-separated (empty string when none). */
	tags_providers_csv: string | null;

	// Main content (beholder MainContentsData / ScrollHeightData, written by
	// archive/meta/compute-main-contents-denormalized). Null for pages that
	// were not fully rendered. Full per-element detail lives in the
	// `page_main_content_*` child tables (see `Page.getHeadings()` etc.).
	/** Detected main-content element's `nodeName` (e.g. `'MAIN'`), or null. */
	main_content_node_name: string | null;
	/** Detected main-content element's `id`, or null. */
	main_content_id: string | null;
	/** Detected main-content element's `role` attribute, or null. */
	main_content_role: string | null;
	/** Diagnostic tag+id+class selector for the detected element, or null. */
	main_content_selector: string | null;
	/** JSON-encoded array of the detected element's CSS classes, or null. */
	main_content_class_list: string | null;
	/** Character count of the main region's text content, or null. */
	main_content_word_count: number | null;
	/** Character count of `document.body`'s text content, or null. */
	main_content_body_word_count: number | null;
	/** Number of headings within the main region, or null. */
	main_content_heading_count: number | null;
	/** Number of images within the main region, or null. */
	main_content_image_count: number | null;
	/** Number of tables within the main region, or null. */
	main_content_table_count: number | null;
	/** Number of button-like elements within the main region, or null. */
	main_content_button_count: number | null;
	/** Number of iframes within the main region, or null. */
	main_content_iframe_count: number | null;
	/** Number of videos within the main region, or null. */
	main_content_video_count: number | null;
	/** Number of audios within the main region, or null. */
	main_content_audio_count: number | null;
	/** Number of canvases within the main region, or null. */
	main_content_canvas_count: number | null;
	/** `document.body.scrollHeight` at the desktop-compact preset, or null. */
	scroll_height_desktop: number | null;
	/** `document.body.scrollHeight` at the mobile-small preset, or null. */
	scroll_height_mobile: number | null;

	/** JSON-serialised nested Meta sub-objects not flattened above. */
	meta_extras: string | null;

	/** JSON-serialized network logs captured during scraping, or null if not collected. */
	networkLogs: string | null;
	/** Whether the page was skipped during crawling (1) or processed normally (0). */
	isSkipped: 0 | 1;
	/** The reason the page was skipped, or null if it was not skipped. */
	skipReason: string | null;
	/** The natural URL sort order index, or null if not yet assigned. */
	order: number | null;
	/** Provenance of the row — see {@link PageSource}. */
	source: PageSource;
}

/**
 * Raw database row representing a redirect relationship.
 * Maps a source page to its redirect destination.
 * @example
 * const redirect: DB_Redirect = {
 *   pageId: 9, // destination page id
 *   from: 'http://example.com/old',
 *   fromId: 3,
 * };
 */
export interface DB_Redirect {
	/** The ID of the destination page after redirect. */
	pageId: number;
	/** The URL that was redirected from. */
	from: string;
	/** The page ID of the source URL that was redirected. */
	fromId: number;
}

/**
 * Flat anchor-row shape reconstructed by joining `anchor_edges` with the
 * destination's `content_items` row and the ref tables. Also mirrors the
 * pre-0.13 legacy `anchors` join shape read by the migration populate code.
 * @example
 * const anchors = await accessor.getAnchorsOnPage(pageId);
 * const brokenLinks = anchors.filter((a) => a.status === 404);
 */
export interface DB_Anchor {
	/** The ID of the page that contains this anchor. */
	pageId: number;
	/** The resolved destination URL of the anchor. */
	url: string;
	/** The original href attribute value of the anchor element. */
	href: string;
	/** Whether the anchor points to an external domain (1) or internal (0). */
	isExternal: 0 | 1;
	/** The title attribute of the anchor element, or null if not present. */
	title: string | null;
	/** The HTTP status code of the linked page, or null if not yet fetched. */
	status: number | null;
	/** The HTTP status text of the linked page, or null if not yet fetched. */
	statusText: string | null;
	/** The content type of the linked page, or null if not yet fetched. */
	contentType: string | null;
	/** The URL fragment (hash) portion of the link, or null if not present. */
	hash: string | null;
	/** The text content of the anchor element, or null if empty. */
	textContent: string | null;
}

/**
 * Raw database row representing a referrer relationship.
 * Indicates which page links to which other page, potentially through redirects.
 * @example
 * const referrers = await accessor.getReferrersOfPage(pageId);
 * // `through` differs from the destination URL when the link passed
 * // through a redirect source.
 */
export interface DB_Referrer {
	/** The ID of the page being referred to. */
	pageId: number;
	/** The URL of the referring page. */
	url: string;
	/** The URL through which the referral passes (may differ from url due to redirects). */
	through: string;
	/** The page ID of the through URL. */
	throughId: number;
	/** The URL fragment (hash) of the referring link, or null if not present. */
	hash: string | null;
	/** The text content of the referring anchor element, or null if empty. */
	textContent: string | null;
}

/**
 * Raw database row of the pre-0.13 legacy `images` table. The table only
 * exists inside pre-0.13 input archives; current archives store images in
 * `image_items`. This type is read exclusively by the 0.13 migration
 * populate code (`populate-image-items.ts`), which converts these rows
 * into `image_items` before the legacy table is dropped.
 * @example
 * // Inside migration populate code reading a pre-0.13 input archive:
 * const images: DB_Image[] = await trx('images').where('pageId', pageId);
 * const missingAlt = images.filter((img) => img.alt === null);
 */
export interface DB_Image {
	/** Auto-incremented primary key. */
	id: number;
	/** Foreign key to the page that contains this image. */
	pageId: number;
	/** The `src` attribute value of the image element. */
	src: string | null;
	/** The actual loaded source URL of the image (after srcset/picture resolution). */
	currentSrc: string | null;
	/** The `alt` attribute value, or null if not present. */
	alt: string | null;
	/** The rendered width of the image in CSS pixels. */
	width: number;
	/** The rendered height of the image in CSS pixels. */
	height: number;
	/** The intrinsic width of the image in pixels. */
	naturalWidth: number;
	/** The intrinsic height of the image in pixels. */
	naturalHeight: number;
	/** Whether the image uses lazy loading. */
	isLazy: number | null;
	/** The viewport width at the time of capture. */
	viewportWidth: number;
	/** The raw HTML source code of the image element. */
	sourceCode: string | null;
}

/**
 * Represents a page that links to another page (an incoming link).
 * @example
 * const referrer: Referrer = {
 *   url: 'https://example.com/from',
 *   through: 'https://example.com/old',
 *   throughId: 3,
 *   hash: null,
 *   textContent: 'Link text',
 * };
 */
export interface Referrer {
	/** The URL of the referring page. */
	url: string;
	/** The URL through which the referral passes (may differ due to redirects). */
	through: string;
	/** The page ID corresponding to the through URL. */
	throughId: number;
	/** The URL fragment (hash) of the referring link, or null if not present. */
	hash: string | null;
	/** The text content of the referring anchor element. */
	textContent: string;
}

/**
 * Represents an outgoing link (anchor element) found on a page.
 * @example
 * const anchor: Anchor = {
 *   url: 'https://example.com/about',
 *   href: '/about',
 *   isExternal: false,
 *   title: null,
 *   status: 200,
 *   statusText: 'OK',
 *   contentType: 'text/html',
 *   hash: null,
 *   textContent: 'About us',
 * };
 */
export interface Anchor {
	/** The resolved destination URL of the anchor. */
	url: string;
	/** The original href attribute value of the anchor element. */
	href: string;
	/** Whether the anchor points to an external domain. */
	isExternal: boolean;
	/** The title attribute of the anchor element, or null if not present. */
	title: string | null;
	/** The HTTP status code of the linked page, or null if not yet fetched. */
	status: number | null;
	/** The HTTP status text of the linked page, or null if not yet fetched. */
	statusText: string | null;
	/** The content type of the linked page, or null if not yet fetched. */
	contentType: string | null;
	/** The URL fragment (hash) portion of the link, or null if not present. */
	hash: string | null;
	/** The text content of the anchor element, or null if empty. */
	textContent: string | null;
}

/**
 * Represents a page that redirects to this page.
 * @example
 * const redirect: Redirect = { url: 'http://example.com/old', pageId: 3 };
 */
export interface Redirect {
	/** The URL of the redirect source page. */
	url: string;
	/** The database ID of the redirect source page. */
	pageId: number;
}

/**
 * Raw database row representing a sub-resource (CSS, JS, image, etc.) in the `resources` table.
 * @example
 * const resources = await accessor.getResources();
 * const notFound = resources.filter((r) => r.status === 404);
 */
export interface DB_Resource {
	/** Auto-incremented primary key. */
	id: number;
	/**
	 * The URL of the resource, or `null` when its identity URL is a large
	 * `data:` URI routed to `blob_refs` instead of `url_refs` (mirrors
	 * `image_items`' src/blob convention — see `build-resource-query.ts`).
	 */
	url: string | null;
	/** Whether the resource is hosted on an external domain (1) or internal (0). */
	isExternal: 0 | 1;
	/** HTTP response status code, or null if not yet fetched. */
	status: number | null;
	/** HTTP response status text, or null if not yet fetched. */
	statusText: string | null;
	/** MIME content type of the resource, or null if unknown. */
	contentType: string | null;
	/** Content length in bytes, or null if unknown. */
	contentLength: number | null;
	/** Compression encoding (e.g., "gzip", "br"), or 0 if not compressed. */
	compress: string | 0;
	/** CDN provider identifier, or 0 if not served from a CDN. */
	cdn: string | 0;
	/** JSON-serialized HTTP response headers, or null if not available. */
	responseHeaders: string | null;
	/** Provenance of the row — see {@link PageSource}. */
	source: PageSource;
}

/**
 * Connection options for the archive's libsql-backed database.
 * @example
 * const db = await Database.connect({
 *   filename: '/path/to/._nitpicker-site/db.sqlite',
 *   readOnly: true,
 * });
 */
export interface DatabaseOption {
	/** The absolute file path to the SQLite database file. */
	filename: string;
	/**
	 * When `true`, open the database for read-only inspection:
	 *
	 * - Skip schema migrations (no `ALTER TABLE` / `UPDATE` on the user's file).
	 * - Refuse to mkdir/create the parent dir or the db file — fail loudly if
	 *   either is missing instead of resurrecting them.
	 *
	 * Used by the viewer / MCP server when attaching to an in-progress crawl's
	 * tmpDir, where any write would race the live crawler.
	 */
	readOnly?: boolean;
}
