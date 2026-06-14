/**
 * The opened-archive kind reported by {@link ArchiveManager}.
 *
 * - `'archive'` — a finished `.nitpicker` tar file on disk, opened by
 *   extracting it into a fresh tmpDir.
 * - `'stub'` — an in-progress (or interrupted) crawl's tmpDir, opened in
 *   place for read-only inspection. No extraction, no lock acquisition,
 *   no write-back on close.
 */
export type ArchiveMode = 'archive' | 'stub';

/**
 * Options for opening a .nitpicker archive file.
 */
export interface OpenArchiveOptions {
	/** Absolute or relative path to the .nitpicker archive file. */
	filePath: string;
}

/**
 * Result returned after successfully opening an archive.
 */
export interface OpenArchiveResult {
	/** The identifier used to reference this archive in subsequent queries. */
	archiveId: string;
	/** The base URL of the crawled site stored in the archive. Equals `roots[0]` for multi-root archives. */
	baseUrl: string;
	/** All user-provided root URLs. Single-root archives report `[baseUrl]`. */
	roots: string[];
	/** Total number of pages stored in the archive. */
	totalPages: number;
}

/**
 * Coarse-grained Content-Type category used by the viewer summary and
 * page-list filter. The raw MIME string (after parameter stripping) is
 * mapped to one of these labels by `classifyContentType`.
 */
export type ContentTypeCategory =
	| 'html'
	| 'pdf'
	| 'csv'
	| 'word'
	| 'excel'
	| 'powerpoint'
	| 'image'
	| 'css'
	| 'javascript'
	| 'json'
	| 'xml'
	| 'font'
	| 'audio'
	| 'video'
	| 'archive'
	| 'text'
	| 'other'
	| 'unknown';

/**
 * A count of in-scope rows (HTML pages + KNOWN non-HTML targets like PDF /
 * image / zip) grouped by their canonical {@link ContentTypeCategory} and
 * by `isExternal`. Errored / not-yet-classified rows are bucketed under
 * `'unknown'` so the user can see the broken slice at a glance.
 */
export interface ContentTypeCount {
	/** The canonical content-type category. */
	category: ContentTypeCategory;
	/** Number of internal (`isExternal = 0`) pages in this category. */
	internal: number;
	/** Number of external (`isExternal = 1`) pages in this category. */
	external: number;
}

/**
 * Site-wide summary statistics for a crawled archive.
 */
export interface SummaryResult {
	/** The base URL of the crawled site. Equals `roots[0]` for multi-root archives. */
	baseUrl: string;
	/** All user-provided root URLs. Single-root archives report `[baseUrl]`. */
	roots: string[];
	/**
	 * Total number of HTML pages (internal + external) — the historical
	 * "pages" count, restricted to `contentType IS NULL OR text/html` so
	 * PDFs / images / archives don't inflate it. Kept on the API for
	 * backward compatibility (CLI / MCP consumers may surface it
	 * directly); the viewer dashboard now prefers
	 * {@link internalPages} / {@link internalContents} /
	 * {@link externalContents} for clearer reads.
	 */
	totalPages: number;
	/**
	 * Number of internal HTML pages (`isExternal = 0` AND
	 * `contentType IS NULL OR text/html`). This is the "real pages we
	 * crawled and rendered" number, excluding non-HTML targets like
	 * PDFs or downloads.
	 */
	internalPages: number;
	/**
	 * Number of external HTML pages (`isExternal = 1` AND HTML-or-null).
	 * Kept for backward compatibility; the viewer now prefers
	 * {@link externalContents} which counts every external link
	 * regardless of MIME.
	 */
	externalPages: number;
	/**
	 * Number of internal **content rows** (every `isExternal = 0` page
	 * in the archive — HTML pages plus typed non-HTML targets such as
	 * PDFs, CSVs, ZIPs, Office docs). This is the broader "how much
	 * stuff lives under the in-scope domains" number, with no MIME
	 * filter. Always `>= internalPages`.
	 */
	internalContents: number;
	/**
	 * Number of external **content rows** (every `isExternal = 1` page
	 * in the archive, any MIME). This is the "how many distinct
	 * outbound links did we find" number. Always `>= externalPages`.
	 */
	externalContents: number;
	/** Distribution of HTTP status codes across all pages. */
	statusDistribution: StatusCount[];
	/** Metadata fulfillment rates for internal pages. */
	metadataFulfillment: MetadataFulfillment;
	/**
	 * Distribution of {@link ContentTypeCategory} across all in-scope rows
	 * (HTML pages plus known non-HTML targets such as PDFs). Sorted by total
	 * count descending so the dominant types lead the chart.
	 */
	contentTypeDistribution: ContentTypeCount[];
}

/**
 * A count of pages grouped by HTTP status code.
 */
export interface StatusCount {
	/** HTTP status code (e.g. 200, 301, 404). */
	status: number | null;
	/** Number of pages with this status code. */
	count: number;
}

/**
 * Metadata fulfillment rates as ratios (0.0–1.0).
 */
export interface MetadataFulfillment {
	/** Ratio of pages with a title set. */
	title: number;
	/** Ratio of pages with a description set. */
	description: number;
	/** Ratio of pages with keywords set. */
	keywords: number;
	/** Ratio of pages with og:title set. */
	ogTitle: number;
	/** Ratio of pages with og:description set. */
	ogDescription: number;
	/** Ratio of pages with og:image set. */
	ogImage: number;
}

/**
 * Filter and pagination options for listing pages.
 */
export interface ListPagesOptions {
	/** Filter by HTTP status code. */
	status?: number;
	/** Filter by minimum status code (inclusive). */
	statusMin?: number;
	/** Filter by maximum status code (inclusive). */
	statusMax?: number;
	/** Filter by external (true) or internal (false) pages. */
	isExternal?: boolean;
	/**
	 * Restrict results to a single {@link ContentTypeCategory}. When set, the
	 * default HTML-or-null base restriction is RELAXED — passing `'pdf'` shows
	 * the PDFs that are normally hidden from the Pages view. Omit to keep the
	 * default (HTML + not-yet-classified rows).
	 */
	contentTypeCategory?: ContentTypeCategory;
	/** Filter to pages missing title metadata. */
	missingTitle?: boolean;
	/** Filter to pages missing description metadata. */
	missingDescription?: boolean;
	/** Filter to pages with noindex set. */
	noindex?: boolean;
	/** URL pattern to search (SQL LIKE pattern). */
	urlPattern?: string;
	/** Directory path prefix to filter by. */
	directory?: string;
	/** Field to sort results by. */
	sortBy?: 'url' | 'status' | 'title';
	/** Sort direction. */
	sortOrder?: 'asc' | 'desc';
	/** Maximum number of results to return. Defaults to 100. */
	limit?: number;
	/** Number of results to skip. Defaults to 0. */
	offset?: number;
}

/**
 * A page list entry with core metadata.
 */
export interface PageListItem {
	/** The page URL. */
	url: string;
	/** The page title. */
	title: string | null;
	/** HTTP status code. */
	status: number | null;
	/** Content type. */
	contentType: string | null;
	/** Whether the page is external. */
	isExternal: boolean;
	/** Whether the page has a description. */
	hasDescription: boolean;
	/** Whether the page has og:title. */
	hasOgTitle: boolean;
	/** Whether noindex is set. */
	noindex: boolean;
	/** Meta description. */
	description: string | null;
	/** Meta keywords. */
	keywords: string | null;
	/** Language attribute. */
	lang: string | null;
	/** Whether nofollow is set. */
	nofollow: boolean;
	/** Whether noarchive is set. */
	noarchive: boolean;
	/** Canonical URL. */
	canonical: string | null;
	/** Alternate URL. */
	alternate: string | null;
	/** OG type. */
	ogType: string | null;
	/** OG title. */
	ogTitle: string | null;
	/** OG site name. */
	ogSiteName: string | null;
	/** OG description. */
	ogDescription: string | null;
	/** OG URL. */
	ogUrl: string | null;
	/** OG image URL. */
	ogImage: string | null;
	/** Twitter card type. */
	twitterCard: string | null;
}

/**
 * Paginated result wrapper for page lists.
 */
export interface PaginatedPageList {
	/** The page list items. */
	items: PageListItem[];
	/** Total number of matching pages (before pagination). */
	total: number;
	/** Current offset. */
	offset: number;
	/** Current limit. */
	limit: number;
}

/**
 * Detailed information about a single page.
 */
export interface PageDetail {
	/** The page URL. */
	url: string;
	/** HTTP status code. */
	status: number | null;
	/** HTTP status text. */
	statusText: string | null;
	/** Content type. */
	contentType: string | null;
	/** Content length in bytes. */
	contentLength: number | null;
	/** Whether the page is external. */
	isExternal: boolean;
	/** The page title. */
	title: string | null;
	/** Meta description. */
	description: string | null;
	/** Meta keywords. */
	keywords: string | null;
	/** Language attribute. */
	lang: string | null;
	/** Canonical URL. */
	canonical: string | null;
	/** Alternate URL. */
	alternate: string | null;
	/** Whether noindex is set. */
	noindex: boolean;
	/** Whether nofollow is set. */
	nofollow: boolean;
	/** Whether noarchive is set. */
	noarchive: boolean;
	/** OG type. */
	ogType: string | null;
	/** OG title. */
	ogTitle: string | null;
	/** OG site name. */
	ogSiteName: string | null;
	/** OG description. */
	ogDescription: string | null;
	/** OG URL. */
	ogUrl: string | null;
	/** OG image URL. */
	ogImage: string | null;
	/** Twitter card type. */
	twitterCard: string | null;
	/** Response headers as key-value pairs. */
	responseHeaders: Record<string, string>;
	/** Outgoing links from this page. */
	outboundLinks: OutboundLink[];
	/** Incoming links to this page. */
	inboundLinks: InboundLink[];
	/** URLs that redirect to this page. */
	redirectFrom: string[];
}

/**
 * An outgoing link found on a page.
 */
export interface OutboundLink {
	/** The destination URL. */
	url: string;
	/** The anchor text content. */
	textContent: string | null;
	/** HTTP status of the destination. */
	status: number | null;
	/** Whether the link is external. */
	isExternal: boolean;
}

/**
 * An incoming link pointing to a page.
 */
export interface InboundLink {
	/** The URL of the referring page. */
	url: string;
	/** The anchor text content. */
	textContent: string | null;
}

/**
 * Filter options for listing links.
 */
export interface ListLinksOptions {
	/** Filter type for links. */
	type: 'broken' | 'external' | 'orphaned';
	/** Maximum number of results. */
	limit?: number;
	/** Number of results to skip. */
	offset?: number;
}

/**
 * A link entry in link analysis results.
 */
export interface LinkEntry {
	/** The source page URL. */
	sourceUrl: string;
	/** The destination URL. */
	destUrl: string;
	/** HTTP status of the destination. */
	status: number | null;
	/** Whether the link is external. */
	isExternal: boolean;
	/** The anchor text. */
	textContent: string | null;
}

/**
 * Result of link analysis.
 */
export interface LinkAnalysisResult {
	/** The link entries. */
	items: LinkEntry[];
	/** Total count of matching links. */
	total: number;
}

/**
 * Orphaned page entry (page with no incoming links).
 */
export interface OrphanedPageEntry {
	/** The orphaned page URL. */
	url: string;
	/** HTTP status code. */
	status: number | null;
	/** Page title. */
	title: string | null;
}

/**
 * Filter options for listing resources.
 */
export interface ListResourcesOptions {
	/** Filter by content type prefix (e.g., "text/css", "application/javascript"). */
	contentType?: string;
	/** Filter by external (true) or internal (false) resources. */
	isExternal?: boolean;
	/** Maximum number of results. */
	limit?: number;
	/** Number of results to skip. */
	offset?: number;
}

/**
 * A resource entry with metadata.
 */
export interface ResourceEntry {
	/** The resource URL. */
	url: string;
	/** HTTP status code. */
	status: number | null;
	/** HTTP status text. */
	statusText: string | null;
	/** Content type. */
	contentType: string | null;
	/** Content length in bytes. */
	contentLength: number | null;
	/** Whether the resource is external. */
	isExternal: boolean;
	/** Number of pages referencing this resource. */
	referrerCount: number;
	/** Compression type (e.g., "gzip", "br"). */
	compress: string | null;
	/** CDN provider. */
	cdn: string | null;
}

/**
 * Paginated result for resource listing.
 */
export interface PaginatedResourceList {
	/** Resource entries. */
	items: ResourceEntry[];
	/** Total matching resources. */
	total: number;
	/** Current offset. */
	offset: number;
	/** Current limit. */
	limit: number;
}

/**
 * Filter options for listing images.
 */
export interface ListImagesOptions {
	/** Filter to images missing alt attribute. */
	missingAlt?: boolean;
	/** Filter to images missing explicit width/height attributes. */
	missingDimensions?: boolean;
	/** Filter to images with naturalWidth or naturalHeight exceeding this threshold. */
	oversizedThreshold?: number;
	/** URL pattern to filter source URLs. */
	urlPattern?: string;
	/** Maximum number of results. */
	limit?: number;
	/** Number of results to skip. */
	offset?: number;
}

/**
 * An image entry with metadata.
 */
export interface ImageEntry {
	/** The page URL containing this image. */
	pageUrl: string;
	/** The src attribute. */
	src: string | null;
	/** The alt attribute. */
	alt: string | null;
	/** Rendered width. */
	width: number;
	/** Rendered height. */
	height: number;
	/** Intrinsic width. */
	naturalWidth: number;
	/** Intrinsic height. */
	naturalHeight: number;
	/** Whether the image uses lazy loading. */
	isLazy: boolean;
}

/**
 * Paginated result for image listing.
 */
export interface PaginatedImageList {
	/** Image entries. */
	items: ImageEntry[];
	/** Total matching images. */
	total: number;
	/** Current offset. */
	offset: number;
	/** Current limit. */
	limit: number;
}

/**
 * Options for querying analysis violations.
 */
export interface GetViolationsOptions {
	/** Filter by validator name (e.g., "axe", "markuplint"). */
	validator?: string;
	/** Filter by severity level. */
	severity?: string;
	/** Filter by rule ID. */
	rule?: string;
	/** Maximum number of results. */
	limit?: number;
	/** Number of results to skip. */
	offset?: number;
}

/**
 * A page with duplicate title or description.
 */
export interface DuplicateEntry {
	/** The field that is duplicated. */
	field: 'title' | 'description';
	/** The duplicated value. */
	value: string;
	/** URLs sharing this value. */
	urls: string[];
	/** Number of pages with this duplicate value. */
	count: number;
}

/**
 * A metadata mismatch found on a page.
 */
export interface MismatchEntry {
	/** The page URL. */
	url: string;
	/** The type of mismatch. */
	type: 'canonical' | 'og:title' | 'og:description';
	/** The actual page value. */
	actual: string | null;
	/** The expected or compared value. */
	expected: string | null;
}

/**
 * Security header check result for a page.
 */
export interface HeaderCheckEntry {
	/** The page URL. */
	url: string;
	/** Whether Content-Security-Policy header is present. */
	hasCSP: boolean;
	/** Whether X-Frame-Options header is present. */
	hasXFrameOptions: boolean;
	/** Whether X-Content-Type-Options header is present. */
	hasXContentTypeOptions: boolean;
	/** Whether Strict-Transport-Security header is present. */
	hasHSTS: boolean;
}

/**
 * Paginated result for header checks.
 */
export interface PaginatedHeaderCheckList {
	/** Header check entries. */
	items: HeaderCheckEntry[];
	/** Total matching pages. */
	total: number;
	/** Current offset. */
	offset: number;
	/** Current limit. */
	limit: number;
}

/**
 * A node in the internal-page link graph (one internal HTML page).
 */
export interface GraphNode {
	/** The page URL (also the node identifier). */
	url: string;
	/** HTTP status code. */
	status: number | null;
	/** Number of incoming internal links (used for node sizing). */
	inDegree: number;
}

/**
 * A directed edge in the link graph (a link from one internal page to another).
 */
export interface GraphEdge {
	/** Source page URL. */
	source: string;
	/** Destination page URL. */
	target: string;
}

/**
 * The internal-page link graph: nodes (internal HTML pages) and the directed
 * edges between them. External pages, non-HTML pages, redirects, and
 * self-links are excluded.
 */
export interface LinkGraph {
	/** The internal HTML page nodes (capped to the top in-degree nodes when `limit` is set). */
	nodes: GraphNode[];
	/** Distinct directed links between the included nodes. */
	edges: GraphEdge[];
	/** Whether nodes were truncated to `limit` (more internal pages exist than returned). */
	truncated: boolean;
}

/**
 * Options for `getLinkGraph`.
 */
export interface GetLinkGraphOptions {
	/**
	 * Maximum number of nodes to return, keeping the highest in-degree pages.
	 * Omit for all internal pages.
	 */
	limit?: number;
}

/**
 * A page-level network entry — one row per page — mirroring the
 * google-sheets "Links" sheet: status, redirects, referrer count, and headers.
 */
export interface PageLinkEntry {
	/** The page URL. */
	url: string;
	/** The page title. */
	title: string | null;
	/** HTTP status code. */
	status: number | null;
	/** HTTP status text. */
	statusText: string | null;
	/** Content type. */
	contentType: string | null;
	/** Number of pages that redirect to this page. */
	redirectFromCount: number;
	/** Number of pages linking to this page (incoming links). */
	referrerCount: number;
	/** Whether the page has stored response headers. */
	hasResponseHeaders: boolean;
	/** Skip reason if the page was skipped during crawling. */
	skipReason: string | null;
}

/**
 * Paginated result for the page-level link/network list.
 */
export interface PaginatedPageLinkList {
	/** Page link entries. */
	items: PageLinkEntry[];
	/** Total matching pages. */
	total: number;
	/** Current offset. */
	offset: number;
	/** Current limit. */
	limit: number;
}

/**
 * Filter and pagination options for {@link PageLinkEntry} listing.
 */
export interface ListPageLinksOptions {
	/** Filter by external (true) or internal (false). */
	isExternal?: boolean;
	/** URL pattern to search (SQL LIKE pattern). */
	urlPattern?: string;
	/** Maximum number of results. */
	limit?: number;
	/** Number of results to skip. */
	offset?: number;
}
