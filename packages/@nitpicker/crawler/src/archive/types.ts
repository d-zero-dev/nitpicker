import type { ParseURLOptions } from '@d-zero/shared/parse-url';

/**
 * Event map for database-related events emitted by the Database and ArchiveAccessor classes.
 */
export interface DatabaseEvent {
	/** An error that occurred during a database operation. */
	error: Error;
}

/**
 * Configuration stored in the archive database's `info` table.
 * Represents all crawling options that were used for the crawl session.
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
 * Raw database row representing a crawled page in the `pages` table.
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
	/** The `lang` attribute value from the HTML element, or null if not present. */
	lang: string | null;
	/** The page title from the `<title>` element, or null if not present. */
	title: string | null;
	/** The meta description content, or null if not present. */
	description: string | null;
	/** The meta keywords content, or null if not present. */
	keywords: string | null;
	/** Whether the noindex robots directive is set (SQLite INTEGER 0/1). */
	noindex: number | null;
	/** Whether the nofollow robots directive is set (SQLite INTEGER 0/1). */
	nofollow: number | null;
	/** Whether the noarchive robots directive is set (SQLite INTEGER 0/1). */
	noarchive: number | null;
	/** The canonical URL from `<link rel="canonical">`, or null if not present. */
	canonical: string | null;
	/** The alternate URL from `<link rel="alternate">`, or null if not present. */
	alternate: string | null;
	/** The Open Graph type (`og:type`), or null if not present. */
	og_type: string | null;
	/** The Open Graph title (`og:title`), or null if not present. */
	og_title: string | null;
	/** The Open Graph site name (`og:site_name`), or null if not present. */
	og_site_name: string | null;
	/** The Open Graph description (`og:description`), or null if not present. */
	og_description: string | null;
	/** The Open Graph URL (`og:url`), or null if not present. */
	og_url: string | null;
	/** The Open Graph image URL (`og:image`), or null if not present. */
	og_image: string | null;
	/** The Twitter Card type (`twitter:card`), or null if not present. */
	twitter_card: string | null;
	/** JSON-serialized network logs captured during scraping, or null if not collected. */
	networkLogs: string | null;
	/** Whether the page was skipped during crawling (1) or processed normally (0). */
	isSkipped: 0 | 1;
	/** The reason the page was skipped, or null if it was not skipped. */
	skipReason: string | null;
	/** The natural URL sort order index, or null if not yet assigned. */
	order: number | null;
}

/**
 * Raw database row representing a redirect relationship.
 * Maps a source page to its redirect destination.
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
 * Raw database row representing an anchor (link) found on a page.
 * Combines data from the `anchors` table and the linked `pages` table.
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
 * Raw database row representing an image element found on a page in the `images` table.
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
 */
export interface Redirect {
	/** The URL of the redirect source page. */
	url: string;
	/** The database ID of the redirect source page. */
	pageId: number;
}

/**
 * Raw database row representing a sub-resource (CSS, JS, image, etc.) in the `resources` table.
 */
export interface DB_Resource {
	/** Auto-incremented primary key. */
	id: number;
	/** The URL of the resource. */
	url: string;
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
}

/**
 * Connection options for the archive's libsql-backed database.
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
