/**
 * The opened-archive kind reported by {@link import('./archive-manager.js').ArchiveManager}.
 *
 * - `'archive'` — a finished `.nitpicker` tar file on disk, opened by
 *   extracting it into a fresh tmpDir.
 * - `'stub'` — an in-progress (or interrupted) crawl's tmpDir, opened in
 *   place for read-only inspection. No extraction, no lock acquisition,
 *   no write-back on close.
 */
export type ArchiveMode = 'archive' | 'stub';

// Re-export the canonical PageSource / ErrorKind owned by the crawler
// package — keeps query consumers (CLI / MCP / viewer) from reaching across
// packages for the same enums. crawler needs ErrorKind for its DNS-burned
// host cache and cannot depend on query.
export type { PageSource, ErrorKind } from '@nitpicker/crawler';
import type { ErrorKind, PageSource } from '@nitpicker/crawler';

/**
 * One row of {@link import('./list-isolated-pages.js').listIsolatedPages} output — a **完全孤立** (singleton)
 * inventory-* HTML page with no resolved-anchor inbound from any other
 * inventory-* node.
 *
 * Source is typically `'inventory-seed'` — a freshly discovered page
 * normally carries its discoverer's anchor inbound and so is excluded
 * from singletons. However, an `'inventory-discovered'` row CAN appear
 * here if the crawled-wins downgrade later demoted its discoverer (the
 * discoverer became `'crawled'`, breaking the inventory-subgraph edge
 * even though the anchor row still exists in `anchors`). Both source
 * labels are valid and shown via the same `SourceBadge` UI.
 */
export interface IsolatedPageEntry {
	/** Page URL. */
	url: string;
	/** `<title>` value, or `null` if absent. */
	title: string | null;
	/** HTTP status of the page, or `null` if not yet known. */
	status: number | null;
	/** Provenance label — see {@link PageSource}. Either `'inventory-seed'` or `'inventory-discovered'`. */
	source: PageSource;
}

/**
 * Pagination options for {@link import('./list-isolated-pages.js').listIsolatedPages}.
 */
export interface ListIsolatedPagesOptions {
	/** URL pattern to search (SQL LIKE-ish substring for computed results). */
	urlPattern?: string;
	/** Filter by HTTP status. */
	status?: number;
	/** Filter by source. */
	source?: PageSource;
	/** Field to sort results by. */
	sortBy?: 'url' | 'title' | 'status' | 'source';
	/** Sort direction. */
	sortOrder?: SortOrder;
	/** Maximum rows to return. Defaults to 100. */
	limit?: number;
	/** Rows to skip from the start. Defaults to 0. */
	offset?: number;
	/**
	 * Pre-computed `computeIsolatedClusters` output. When provided, the
	 * function skips its own SQL pass and reuses the supplied components.
	 * The viewer caches the components per archive across the three
	 * isolated-* endpoints (listIsolatedPages / listIsolatedClusters /
	 * getIsolatedCluster) so that opening any one of them and then
	 * paging through the others does not re-pay the 20-30 s union-find
	 * cost on a 10 GB archive.
	 */
	precomputedComponents?: IsolatedComponent[];
}

/**
 * One row of {@link import('./list-isolated-clusters.js').listIsolatedClusters} output — a connected component of
 * the inventory-* subgraph with size ≥ 2 (= **孤立集合**).
 *
 * The cluster is identified by `representativeUrl` (the lexicographically
 * smallest member URL). The viewer / CLI / MCP all use this URL as the
 * cluster key when requesting member details via {@link import('./get-isolated-cluster.js').getIsolatedCluster}.
 */
export interface IsolatedClusterSummary {
	/** Lexicographically smallest member URL — the cluster's stable identifier. */
	representativeUrl: string;
	/** `<title>` of the representative member, or `null` if absent. */
	representativeTitle: string | null;
	/** HTTP status of the representative member, or `null` if not yet known. */
	representativeStatus: number | null;
	/** Number of pages in this cluster (always ≥ 2). */
	size: number;
}

/**
 * Result of {@link import('./get-isolated-cluster.js').getIsolatedCluster} — full member list for a single
 * isolated cluster, identified by its representative URL.
 */
export interface IsolatedClusterDetail {
	/** The cluster's representative URL (echoed for caller convenience). */
	representativeUrl: string;
	/** All pages in this cluster, sorted by URL ASC. */
	members: IsolatedClusterMember[];
	/** Number of members (`members.length` — duplicated for symmetry with the summary). */
	size: number;
}

/**
 * One member of an {@link IsolatedClusterDetail}.
 */
export interface IsolatedClusterMember {
	/** Member URL. */
	url: string;
	/** `<title>` value, or `null` if absent. */
	title: string | null;
	/** HTTP status of the member, or `null` if not yet known. */
	status: number | null;
	/** Provenance label — see {@link PageSource}. Either `'inventory-seed'` or `'inventory-discovered'`. */
	source: PageSource;
}

/**
 * Connected component of the inventory-* subgraph as computed by
 * `computeIsolatedClusters`. Both {@link import('./list-isolated-clusters.js').listIsolatedClusters} (size ≥ 2)
 * and {@link import('./list-isolated-pages.js').listIsolatedPages} (singletons, size === 1) consume this
 * shared result.
 */
export interface IsolatedComponent {
	/** Lexicographically smallest member URL — the cluster's stable identifier. */
	representativeUrl: string;
	/** All inventory-* pages in this component, sorted by URL ASC. */
	members: IsolatedClusterMember[];
	/** Member count (`members.length`, kept for sort convenience). */
	size: number;
}

/**
 * Pagination options for {@link import('./list-isolated-clusters.js').listIsolatedClusters}.
 */
export interface ListIsolatedClustersOptions {
	/** URL pattern to search representative URLs. */
	urlPattern?: string;
	/** Filter by representative member status. */
	status?: number;
	/** Field to sort results by. */
	sortBy?: 'representativeUrl' | 'representativeTitle' | 'representativeStatus' | 'size';
	/** Sort direction. */
	sortOrder?: SortOrder;
	/** Maximum clusters to return. Defaults to 100. */
	limit?: number;
	/** Clusters to skip from the start. Defaults to 0. */
	offset?: number;
	/**
	 * Pre-computed `computeIsolatedClusters` output. See
	 * {@link ListIsolatedPagesOptions.precomputedComponents} for the
	 * shared-cache rationale.
	 */
	precomputedComponents?: IsolatedComponent[];
}

/**
 * Options for {@link import('./get-isolated-cluster.js').getIsolatedCluster}.
 */
export interface GetIsolatedClusterOptions {
	/** URL pattern to search member URLs. */
	urlPattern?: string;
	/** Filter by HTTP status. */
	status?: number;
	/** Filter by source. */
	source?: PageSource;
	/** Field to sort results by. */
	sortBy?: 'url' | 'title' | 'status' | 'source';
	/** Sort direction. */
	sortOrder?: SortOrder;
	/** Maximum members to return. */
	limit?: number;
	/** Members to skip. */
	offset?: number;
	/**
	 * Pre-computed `computeIsolatedClusters` output. See
	 * {@link ListIsolatedPagesOptions.precomputedComponents} for the
	 * shared-cache rationale.
	 */
	precomputedComponents?: IsolatedComponent[];
}

/**
 * One row of {@link import('./list-unused-resources.js').listUnusedResources} output — an internal sub-resource
 * with zero referrers.
 */
export interface UnusedResourceEntry {
	/** Resource URL. */
	url: string;
	/** HTTP status of the resource, or `null` if not yet known. */
	status: number | null;
	/** Content-Type header value, or `null` if unknown. */
	contentType: string | null;
	/** Content-Length header value in bytes, or `null` if unknown. */
	contentLength: number | null;
	/** Provenance label — see {@link PageSource}. Shown as a viewer badge. */
	source: PageSource;
}

/**
 * Pagination options for {@link import('./list-unused-resources.js').listUnusedResources}.
 */
export interface ListUnusedResourcesOptions {
	/** URL pattern to search. */
	urlPattern?: string;
	/** Filter by HTTP status. */
	status?: number;
	/** Filter by content type prefix. */
	contentType?: string;
	/** Filter by source. */
	source?: PageSource;
	/** Field to sort results by. */
	sortBy?: 'url' | 'status' | 'contentType' | 'contentLength' | 'source';
	/** Sort direction. */
	sortOrder?: SortOrder;
	/** Maximum rows to return. Defaults to 100. */
	limit?: number;
	/** Rows to skip from the start. Defaults to 0. */
	offset?: number;
}

/**
 * Paginated result wrapper for {@link import('./list-unused-resources.js').listUnusedResources}.
 */
export interface PaginatedUnusedResourceList {
	/** Unused-resource entries. */
	items: UnusedResourceEntry[];
	/** Total matching unused resources. */
	total: number;
}

/**
 * Filter and pagination options for {@link import('./list-viewer-unused-resources.js').listViewerUnusedResources}
 * — the `viewer_resources` read-model-backed counterpart of
 * {@link ListUnusedResourcesOptions}.
 *
 * Deliberately narrower than {@link ListUnusedResourcesOptions}: `urlPattern`
 * (LIKE-based) and `contentType` (raw MIME prefix, not the classified
 * `content_category` the read model stores) are excluded — callers that need
 * those fall back to `listUnusedResources` instead.
 */
export interface ListViewerUnusedResourcesOptions {
	/** Filter by exact HTTP status code. */
	status?: number;
	/** Filter by provenance — see {@link PageSource}. */
	source?: PageSource;
	/** Field to sort results by. Defaults to `'url'`. */
	sortBy?: 'url' | 'status' | 'source';
	/** Sort direction. Defaults to `'asc'`. */
	sortOrder?: SortOrder;
	/** Maximum number of results to return. Defaults to 100. */
	limit?: number;
	/**
	 * Opaque keyset cursor from a previous {@link CursorPaginatedUnusedResourceList}'s
	 * `nextCursor`/`prevCursor`. Mutually exclusive with `offset` — when both
	 * are supplied, `cursor` wins. Omit for the first page.
	 */
	cursor?: string;
	/**
	 * Direction to walk from `cursor`: `'next'` (forward, default) or
	 * `'prev'` (backward). Ignored when `cursor` is omitted.
	 */
	direction?: 'next' | 'prev';
	/**
	 * Row offset for page-number jumps (MPA pagination). Mutually exclusive
	 * with `cursor`.
	 */
	offset?: number;
}

/**
 * Paginated result wrapper for {@link import('./list-viewer-unused-resources.js').listViewerUnusedResources}
 * — {@link PaginatedUnusedResourceList} plus keyset cursors for
 * virtual-scroll continuation.
 */
export interface CursorPaginatedUnusedResourceList extends PaginatedUnusedResourceList {
	/**
	 * Opaque cursor to fetch the next page in the current sort order, or
	 * `null` when this is the last page.
	 */
	nextCursor: string | null;
	/**
	 * Opaque cursor to fetch the preceding page, or `null` when this is
	 * already the first page.
	 */
	prevCursor: string | null;
}

/**
 * One row of {@link import('./list-inventory-runs.js').listInventoryRuns} output — one record per successful
 * `--inventory <list>` invocation against the archive.
 *
 * Schema-mirror of the `inventory_runs` table. All NULL semantics, the
 * "ran_at is the only required field" backfill contract, and the
 * append-only invariant live on
 * {@link import('@nitpicker/crawler').InventoryRunMeta} in the crawler
 * package — this interface is the read-side shape.
 */
export interface InventoryRunEntry {
	/** Autoincrement primary key (monotonically increasing per archive). */
	id: number;
	/** ISO 8601 timestamp at which the run completed. */
	ran_at: string;
	/** Human-readable label (auto-generated as `inventory-${ran_at}` when the CLI did not supply one). */
	list_label: string | null;
	/** SHA-256 hex digest of the source file at run time. `null` if hashing failed. */
	source_file_sha256: string | null;
	/** Number of non-empty lines in the input list. */
	total_lines: number | null;
	/** Number of newly-inserted `pages` rows produced by this run. */
	new_pages: number | null;
	/** Number of newly-inserted `resources` rows produced by this run. */
	new_resources: number | null;
	/** Number of input URLs dropped because they fell outside the archived scope. */
	scope_skipped: number | null;
	/** Free-form annotation from a backfill or manual `INSERT`. */
	notes: string | null;
}

/**
 * Pagination options for {@link import('./list-inventory-runs.js').listInventoryRuns}.
 */
export interface ListInventoryRunsOptions {
	/** Maximum rows to return. Defaults to 100. */
	limit?: number;
	/** Rows to skip from the start. Defaults to 0. */
	offset?: number;
}

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
	 * {@link SummaryResult.internalPages} / {@link SummaryResult.internalContents} /
	 * {@link SummaryResult.externalContents} for clearer reads.
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
	 * {@link SummaryResult.externalContents} which counts every external link
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
	/**
	 * Per-cause breakdown of the `status === -1` bucket, classified by
	 * {@link import('@nitpicker/crawler').classifyErrorKind} on the underlying message.
	 *
	 * Present only on the `status === -1` row (the hard-failure sentinel). The
	 * sum of `errorKindBreakdown[*].count` is always equal to the parent
	 * `count` — pages whose message cannot be resolved fall into the
	 * `'unknown'` bucket so the totals stay reconciled.
	 */
	errorKindBreakdown?: ErrorKindCount[];
}

/**
 * One sub-row of {@link StatusCount.errorKindBreakdown} — count of hard-failed
 * pages whose underlying message classifies as this {@link ErrorKind}.
 */
export interface ErrorKindCount {
	/** Classified cause (e.g. `'dns'`, `'timeout'`, `'unknown'`). */
	kind: ErrorKind;
	/** Number of pages classified into this cause. */
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

/** Sort direction for paginated list queries. */
export type SortOrder = 'asc' | 'desc';

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
	/** Filter by document language. */
	lang?: string;
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
	/** Filter by Content-Security-Policy header presence. */
	hasCSP?: boolean;
	/** Filter by X-Frame-Options header presence. */
	hasXFrameOptions?: boolean;
	/** Filter by X-Content-Type-Options header presence. */
	hasXContentTypeOptions?: boolean;
	/** Filter by Strict-Transport-Security header presence. */
	hasHSTS?: boolean;
	/** URL pattern to search (SQL LIKE pattern). */
	urlPattern?: string;
	/** Directory path prefix to filter by. */
	directory?: string;
	/** Field to sort results by. */
	sortBy?:
		| 'url'
		| 'status'
		| 'title'
		| 'contentType'
		| 'isExternal'
		| 'lang'
		| 'description'
		| 'keywords'
		| 'noindex'
		| 'nofollow'
		| 'noarchive'
		| 'canonical'
		| 'twitterCard'
		| 'ogSiteName'
		| 'ogUrl'
		| 'ogTitle'
		| 'ogDescription'
		| 'ogType'
		| 'ogImage'
		| 'ogImageAlt'
		| 'ogLocale'
		| 'ogArticlePublishedTime'
		| 'twitterSite'
		| 'twitterCreator'
		| 'twitterImage'
		| 'charset'
		| 'themeColor'
		| 'manifest'
		| 'robotsRaw'
		| 'tagCount'
		| 'tagsProvidersCsv'
		| 'jsonldCount'
		| 'hasCSP'
		| 'hasXFrameOptions'
		| 'hasXContentTypeOptions'
		| 'hasHSTS';
	/** Sort direction. */
	sortOrder?: SortOrder;
	/** Maximum number of results to return. Defaults to 100. */
	limit?: number;
	/** Number of results to skip. Defaults to 0. */
	offset?: number;
}

/**
 * Raw row shape projected by `listPages` / `listPagesByTag` /
 * `listPagesByJsonLdType` — the SQL columns each query selects from the
 * `pages` table. Kept here so all three callers project the same superset
 * and feed it to `mapPageRowToListItem`.
 */
export interface PageListRow {
	url: string;
	title: string | null;
	status: number | null;
	contentType: string | null;
	isExternal: 0 | 1;
	description: string | null;
	keywords: string | null;
	lang: string | null;
	charset: string | null;
	themeColor: string | null;
	manifest: string | null;
	robots_raw: string | null;
	robots_noindex: number | null;
	robots_nofollow: number | null;
	robots_noarchive: number | null;
	canonical: string | null;
	og_type: string | null;
	og_title: string | null;
	og_site_name: string | null;
	og_description: string | null;
	og_url: string | null;
	og_image: string | null;
	og_image_alt: string | null;
	og_locale: string | null;
	og_article_published_time: string | null;
	twitter_card: string | null;
	twitter_site: string | null;
	twitter_creator: string | null;
	twitter_image: string | null;
	tag_count: number | null;
	jsonld_count: number | null;
	tags_providers_csv: string | null;
	firstCrawledAt: number | null;
	lastCrawledAt: number | null;
	hasCSP: 0 | 1;
	hasXFrameOptions: 0 | 1;
	hasXContentTypeOptions: 0 | 1;
	hasHSTS: 0 | 1;
}

/**
 * A page list entry with core metadata derived from beholder 3.0.0 nested Meta.
 *
 * `meta_extras` (the JSON catch-all) is deliberately excluded so list views
 * (viewer pages grid, MCP `list_pages`, Sheets) stay token-bounded. Fetch
 * the full detail via `getPageDetail(url)` when extras are needed.
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
	/** Whether the robots:noindex directive is set. */
	noindex: boolean;
	/** Meta description. */
	description: string | null;
	/** Meta keywords. */
	keywords: string | null;
	/** Language attribute. */
	lang: string | null;
	/** Whether the robots:nofollow directive is set. */
	nofollow: boolean;
	/** Whether the robots:noarchive directive is set. */
	noarchive: boolean;
	/** Raw `<meta name="robots">` content. */
	robotsRaw: string | null;
	/** Absolutised canonical URL. */
	canonical: string | null;
	/** OG type. */
	ogType: string | null;
	/** OG title. */
	ogTitle: string | null;
	/** OG site name. */
	ogSiteName: string | null;
	/** OG description. */
	ogDescription: string | null;
	/** Absolutised OG URL. */
	ogUrl: string | null;
	/** Absolutised OG image URL. */
	ogImage: string | null;
	/** og:image:alt. */
	ogImageAlt: string | null;
	/** og:locale. */
	ogLocale: string | null;
	/** og:article:published_time. */
	ogArticlePublishedTime: string | null;
	/** Twitter card type. */
	twitterCard: string | null;
	/** twitter:site. */
	twitterSite: string | null;
	/** twitter:creator. */
	twitterCreator: string | null;
	/** Absolutised twitter:image. */
	twitterImage: string | null;
	/** `<meta charset>`. */
	charset: string | null;
	/** Primary theme color. */
	themeColor: string | null;
	/** Absolutised `<link rel="manifest">`. */
	manifest: string | null;
	/** Wappalyzer tag entry count (denormalised). */
	tagCount: number | null;
	/** JSON-LD + SpeculationRules count (denormalised). */
	jsonldCount: number | null;
	/** CSV of Wappalyzer providers (denormalised). */
	tagsProvidersCsv: string | null;
	/** First-discovery UNIX ms (within-archive). */
	firstCrawledAt: number | null;
	/** Most-recent-success UNIX ms (within-archive). */
	lastCrawledAt: number | null;
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
	/** Dynamic enum candidates for table filters, computed from all page rows. */
	facets?: PageListFacets;
}

/** Dynamic enum candidates for Pages table filters. */
export interface PageListFacets {
	/** Distinct HTTP statuses present in the page-list universe. */
	statuses: number[];
	/** Distinct language values present in the page-list universe. */
	langs: string[];
	/** Distinct internal/external flags present in the page-list universe. */
	types: boolean[];
}

/**
 * Filter and pagination options for {@link listViewerPages} — the
 * `viewer_pages` read-model-backed counterpart of {@link ListPagesOptions}.
 *
 * Deliberately narrower than {@link ListPagesOptions}: `urlPattern` /
 * `directory` (LIKE-based) are excluded per `docs/viewer-sql-query-plan.md`'s
 * "Don't make LIKE part of the 100ms contract" — callers that need those
 * fall back to `listPages` instead. `source` is new (not on
 * {@link ListPagesOptions}, which has no equivalent contract to preserve).
 */
export interface ListViewerPagesOptions {
	/** Filter by external (true) or internal (false) pages. */
	isExternal?: boolean;
	/**
	 * Restrict results to a single {@link ContentTypeCategory}. Omit to keep
	 * the default (`'html'` + `'unknown'` — the pre-classified equivalent of
	 * `listPages`'s HTML-or-null base restriction).
	 */
	contentTypeCategory?: ContentTypeCategory;
	/** Filter by exact HTTP status code. */
	status?: number;
	/** Filter by minimum HTTP status code (inclusive). */
	statusMin?: number;
	/** Filter by maximum HTTP status code (inclusive). */
	statusMax?: number;
	/** Filter to pages missing title metadata. */
	missingTitle?: boolean;
	/** Filter to pages missing description metadata. */
	missingDescription?: boolean;
	/** Filter to pages with noindex set. */
	noindex?: boolean;
	/** Filter by provenance — see {@link PageSource}. */
	source?: import('@nitpicker/crawler').PageSource;
	/** Field to sort results by. Defaults to `'url'`. */
	sortBy?: 'url' | 'status' | 'title';
	/** Sort direction. Defaults to `'asc'`. */
	sortOrder?: 'asc' | 'desc';
	/** Maximum number of results to return. Defaults to 100. */
	limit?: number;
	/**
	 * Opaque keyset cursor from a previous {@link CursorPaginatedPageList}'s
	 * `nextCursor`/`prevCursor`. Mutually exclusive with `offset` — when both
	 * are supplied, `cursor` wins. Omit for the first page.
	 */
	cursor?: string;
	/**
	 * Direction to walk from `cursor`: `'next'` (forward, default) or
	 * `'prev'` (backward — used by "scroll up" / "previous page"). Ignored
	 * when `cursor` is omitted.
	 */
	direction?: 'next' | 'prev';
	/**
	 * Row offset for page-number jumps (MPA pagination). Mutually exclusive
	 * with `cursor`. `offset = 0` (or omitted, with no `cursor`) is the fast
	 * "initial query" path; `offset > 0` runs a direct `OFFSET` read against
	 * the narrow `viewer_pages` index rather than the wide `pages` table.
	 */
	offset?: number;
}

/**
 * Paginated result wrapper for {@link listViewerPages} — {@link PaginatedPageList}
 * plus keyset cursors for virtual-scroll continuation.
 */
export interface CursorPaginatedPageList extends PaginatedPageList {
	/**
	 * Opaque cursor to fetch the next page in the current sort order, or
	 * `null` when this is the last page.
	 */
	nextCursor: string | null;
	/**
	 * Opaque cursor to fetch the previous page in the current sort order, or
	 * `null` when this is already the first page.
	 */
	prevCursor: string | null;
}

/**
 * Detailed information about a single page.
 *
 * Includes the full flat meta column set, the `metaExtras` JSON catch-all,
 * and lightweight summaries of `page_jsonld` / `page_tags`. The raw JSON-LD
 * payload and full tag rows are fetched via the dedicated endpoints
 * (`getPageJsonLd(url)` / `getPageTags(url)`) so the page-detail response
 * stays token-bounded for MCP / LLM consumers.
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
	/**
	 * Whether the crawler skipped this URL (robots.txt / `excludeUrls` /
	 * `excludeKeywords`) instead of fetching it. When `true`, the metadata
	 * fields above are unpopulated — {@link PageDetail.skipReason} is the
	 * only field describing this row.
	 */
	isSkipped: boolean;
	/** Why the crawler skipped this URL, or `null` if it was not skipped. */
	skipReason: string | null;

	/** The page title. */
	title: string | null;
	/** Meta description. */
	description: string | null;
	/** Meta keywords. */
	keywords: string | null;
	/** Language attribute. */
	lang: string | null;
	/** `dir` attribute. */
	dir: string | null;
	/** `<meta charset>`. */
	charset: string | null;
	/** Absolutised `<base href>`. */
	baseHref: string | null;
	/** Raw `<meta name="viewport">` content. */
	viewportRaw: string | null;
	/** Primary `<meta name="theme-color">`. */
	themeColor: string | null;
	/** `<meta name="application-name">`. */
	applicationName: string | null;
	/** `<meta name="author">`. */
	author: string | null;
	/** `<meta name="generator">`. */
	generator: string | null;
	/** `<meta name="publisher">`. */
	publisher: string | null;

	/** Raw `<meta name="robots">` content. */
	robotsRaw: string | null;
	/** Whether the robots:noindex directive is set. */
	noindex: boolean;
	/** Whether the robots:nofollow directive is set. */
	nofollow: boolean;
	/** Whether the robots:noarchive directive is set. */
	noarchive: boolean;
	/** Whether the robots:noimageindex directive is set. */
	noimageindex: boolean;
	/** `<meta name="googlebot">` content. */
	googlebot: string | null;

	/** Absolutised `<link rel="canonical">` href. */
	canonical: string | null;
	/** Absolutised `<link rel="amphtml">` href. */
	amphtml: string | null;
	/** Absolutised `<link rel="manifest">` href. */
	manifest: string | null;
	/** Absolutised `<link rel="icon">` href. */
	iconHref: string | null;
	/** Absolutised `<link rel="apple-touch-icon">` href. */
	appleTouchIconHref: string | null;

	/** og:type. */
	ogType: string | null;
	/** og:title. */
	ogTitle: string | null;
	/** Absolutised og:url. */
	ogUrl: string | null;
	/** og:site_name. */
	ogSiteName: string | null;
	/** og:description. */
	ogDescription: string | null;
	/** Absolutised og:image. */
	ogImage: string | null;
	/** og:image:alt. */
	ogImageAlt: string | null;
	/** og:image:width. */
	ogImageWidth: string | null;
	/** og:image:height. */
	ogImageHeight: string | null;
	/** og:locale. */
	ogLocale: string | null;
	/** og:article:published_time. */
	ogArticlePublishedTime: string | null;
	/** og:article:modified_time. */
	ogArticleModifiedTime: string | null;

	/** Twitter card type. */
	twitterCard: string | null;
	/** twitter:site. */
	twitterSite: string | null;
	/** twitter:creator. */
	twitterCreator: string | null;
	/** twitter:title. */
	twitterTitle: string | null;
	/** twitter:description. */
	twitterDescription: string | null;
	/** Absolutised twitter:image. */
	twitterImage: string | null;

	/** Facebook app id (`fb:app_id`). */
	fbAppId: string | null;
	/** Google site verification token. */
	verificationGoogle: string | null;
	/** `format-detection` telephone flag (true / false / null). */
	formatDetectionTelephone: boolean | null;

	/** First-discovery UNIX ms (within-archive). */
	firstCrawledAt: number | null;
	/** Most-recent-success UNIX ms (within-archive). */
	lastCrawledAt: number | null;

	/** Wappalyzer tag entry count (denormalised). */
	tagCount: number | null;
	/** JSON-LD + SpeculationRules count (denormalised). */
	jsonldCount: number | null;
	/** CSV of Wappalyzer providers (denormalised). */
	tagsProvidersCsv: string | null;

	/** Parsed `meta_extras` JSON catch-all (nested sub-objects not flattened). */
	metaExtras: Record<string, unknown>;
	/** Summary of JSON-LD entries (count + types + parseErrorCount). */
	jsonLd: JsonLdSummaryDto;
	/** Summary of Wappalyzer tags (count + provider→ids map). */
	tags: TagsSummaryDto;

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
 * DTO mirror of {@link import('@nitpicker/crawler').JsonLdSummary}.
 *
 * Re-declared in query types so the public DTO does not leak crawler
 * internals; same shape so callers can pass it straight through.
 */
export interface JsonLdSummaryDto {
	/** Total entries across `ld+json` and `speculationrules`. */
	count: number;
	/** Unique `@type` values (sorted). `'(unknown)'` denotes entries without a `@type`. */
	types: readonly string[];
	/** Number of entries that failed to parse. */
	parseErrorCount: number;
}

/**
 * DTO mirror of {@link import('@nitpicker/crawler').TagsSummary}.
 */
export interface TagsSummaryDto {
	/** Total tag rows for the page. */
	count: number;
	/** Provider → list of unique external IDs (sorted). */
	providerIds: Readonly<Record<string, readonly string[]>>;
}

/**
 * One JSON-LD entry returned by `getPageJsonLd(url)`.
 *
 * When `slim` is true (the default), `raw` and `parsed` are omitted so the
 * response stays token-bounded for MCP / LLM consumers. When `slim` is
 * false, both fields are present and the response may reach multi-MB for
 * e-commerce sites.
 */
export interface PageJsonLdEntry {
	/** `'ld+json'` or `'speculationrules'`. */
	kind: 'ld+json' | 'speculationrules';
	/** Top-level `@type`, or null when missing / unparseable. */
	type: string | null;
	/** Byte length of the original `raw` JSON text. Always present so callers can size-check. */
	rawByteSize: number;
	/** Parse error message preserved from beholder; null when the entry parsed cleanly. */
	parseError: string | null;
	/** Original JSON text. Only present when slim=false. */
	raw?: string;
	/** Parsed JSON value. Only present when slim=false. */
	parsed?: unknown;
}

/**
 * One tag entry returned by `getPageTags(url)`.
 */
export interface PageTagEntry {
	/** Wappalyzer provider name. */
	provider: string;
	/** First category (convenience projection). */
	category: string | null;
	/** Real external identifier (GTM-XXXX / G-XXXX / null). */
	externalId: string | null;
	/** Wappalyzer-reported version. */
	version: string | null;
	/** Wappalyzer-reported confidence (0-100). */
	confidence: number | null;
	/** Full categories list. */
	categories: readonly string[];
	/** Source details (script-src / inline / iframe-src / window-global / …). */
	sources: ReadonlyArray<Record<string, unknown>>;
}

/**
 * One overview entry returned by `getPageJsonLdOverview(url)` — the
 * lightweight sibling of `getPageJsonLd`. Lets LLMs see "50 entries totalling
 * 2.5MB" before requesting the full payload.
 */
export interface PageJsonLdOverviewEntry {
	/** `'ld+json'` or `'speculationrules'`. */
	kind: 'ld+json' | 'speculationrules';
	/** Top-level `@type`, or null. */
	type: string | null;
	/** Byte length of the `raw` JSON text. */
	rawByteSize: number;
	/** Parse error (null when parsed cleanly). */
	parseError: string | null;
}

/**
 * Result of `getTagInventory()` — one row per detected Wappalyzer provider
 * across the whole archive.
 */
export interface TagInventoryEntry {
	/** Wappalyzer provider name. */
	provider: string;
	/** Number of distinct pages where the provider was detected. */
	pageCount: number;
}

/**
 * Filter options for `listPagesByTag(provider, externalId?, …)`.
 */
export interface ListPagesByTagOptions {
	/** Wappalyzer provider name. */
	provider: string;
	/** Optional external ID (GTM-XXXX / G-XXXX / …). Omit for any. */
	externalId?: string;
	/** Maximum number of results. */
	limit?: number;
	/** Number of results to skip. */
	offset?: number;
}

/**
 * Filter options for `listPagesByJsonLdType(type, …)`.
 */
export interface ListPagesByJsonLdTypeOptions {
	/** Top-level `@type` value to filter by. */
	type: string;
	/** Maximum number of results. */
	limit?: number;
	/** Number of results to skip. */
	offset?: number;
}

/**
 * Result of `countPagesByTag` / `countPagesByJsonLdType` — the lightweight
 * count-only sibling to the corresponding `list_pages_by_*` queries.
 */
export interface PageCountResult {
	/** Number of distinct pages matching the filter. */
	pageCount: number;
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
 *
 * `'orphaned'` was removed: its semantics collapsed into
 * {@link import('./list-isolated-pages.js').listIsolatedPages} (singleton inventory-* pages) and the new
 * {@link import('./list-isolated-clusters.js').listIsolatedClusters} (cluster-shaped orphans). The remaining
 * `'broken'` / `'external'` types report links where the anchor's resolved
 * final destination matches the criterion — redirect-source rows are
 * walked through `pages.redirectDestId` to the canonical destination before
 * the broken/external judgment is applied, so a 301 hop never counts as a
 * broken link on its own.
 */
export interface ListLinksOptions {
	/** Filter type for links. */
	type: 'broken' | 'external';
	/** Maximum number of results. */
	limit?: number;
	/** Number of results to skip. */
	offset?: number;
	/**
	 * Include anchors whose literal destination is a redirect-source row, in
	 * addition to the default canonical-destination view. Default `false`.
	 */
	includeRedirectSources?: boolean;
	/** URL pattern to search source or destination URLs. */
	urlPattern?: string;
	/** Filter by destination HTTP status. */
	status?: number;
	/** Field to sort results by. */
	sortBy?: 'sourceUrl' | 'destUrl' | 'status' | 'isExternal' | 'textContent';
	/** Sort direction. */
	sortOrder?: SortOrder;
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
 * Filter/sort/pagination options for {@link listViewerBrokenLinks} — the
 * `viewer_anchor_facts` read-model fast path for broken-link listing.
 *
 * `urlPattern` and `includeRedirectSources` are deliberately absent:
 * `urlPattern` matches source OR destination across two columns
 * (`ListLinksOptions`'s semantics), which no single index on
 * `viewer_anchor_facts` can satisfy, so callers with a `urlPattern` set
 * must use `listLinks` instead (see `register-links-route.ts`).
 * `includeRedirectSources` has no equivalent here: `viewer_anchor_facts`
 * only ever stores the canonical (redirect-resolved) destination.
 */
export interface ListViewerBrokenLinksOptions {
	/** Filter by destination HTTP status. Broken links are always `404`, so this is effectively a no-op unless set to a non-`404` value (which then matches nothing). */
	status?: number;
	/** Field to sort results by. Defaults to `'sourceUrl'`. */
	sortBy?: 'sourceUrl' | 'destUrl' | 'status';
	/** Sort direction. Defaults to `'asc'`. */
	sortOrder?: SortOrder;
	/** Maximum number of results to return. Defaults to 100. */
	limit?: number;
	/**
	 * Opaque keyset cursor from a previous {@link CursorPaginatedLinkList}'s
	 * `nextCursor`/`prevCursor`. Mutually exclusive with `offset` — when both
	 * are supplied, `cursor` wins. Omit for the first page.
	 */
	cursor?: string;
	/**
	 * Direction to walk from `cursor`: `'next'` (forward, default) or
	 * `'prev'` (backward). Ignored when `cursor` is omitted.
	 */
	direction?: 'next' | 'prev';
	/**
	 * Row offset for page-number jumps (MPA pagination). Mutually exclusive
	 * with `cursor`.
	 */
	offset?: number;
}

/**
 * Paginated result wrapper for {@link listViewerBrokenLinks} —
 * {@link LinkAnalysisResult} plus keyset cursors for virtual-scroll
 * continuation.
 */
export interface CursorPaginatedLinkList extends LinkAnalysisResult {
	/**
	 * Opaque cursor to fetch the next page in the current sort order, or
	 * `null` when this is the last page.
	 */
	nextCursor: string | null;
	/**
	 * Opaque cursor to fetch the previous page in the current sort order, or
	 * `null` when this is already the first page.
	 */
	prevCursor: string | null;
}

/**
 * Filter/sort/pagination options for {@link import('./list-external-links.js').listExternalLinks}.
 *
 * Unlike {@link ListLinksOptions}, there is no `includeRedirectSources` flag
 * here: this listing's whole premise is "one row per canonical destination",
 * so exposing literal (unresolved) redirect-source destinations would
 * contradict the dedup itself.
 */
export interface ListExternalLinksOptions {
	/**
	 * URL pattern to filter the destination URL (SQL LIKE). There is no
	 * source-URL matching — a row is one destination, not one anchor, so
	 * there is no single "source" to match against. This is a deliberate
	 * behavior change from {@link import('./list-links.js').listLinks}'s `type: 'external'` mode, which
	 * matched source OR destination: the External Links view no longer has a
	 * source-URL column to filter on, so matching only the destination is the
	 * correct semantics for this shape, not an oversight.
	 */
	urlPattern?: string;
	/** Filter by destination HTTP status. */
	status?: number;
	/** Field to sort results by. */
	sortBy?: 'destUrl' | 'status' | 'referrerCount';
	/** Sort direction. */
	sortOrder?: SortOrder;
	/** Maximum number of results. */
	limit?: number;
	/** Number of results to skip. */
	offset?: number;
}

/**
 * One unique external destination, deduplicated by canonical (redirect-
 * resolved) target across every anchor that leads to it.
 */
export interface ExternalLinkEntry {
	/** The canonical (redirect-resolved) destination URL. */
	destUrl: string;
	/** HTTP status of the canonical destination. */
	status: number | null;
	/**
	 * Count of distinct internal pages linking to this destination. Counts
	 * pages, not anchor tags — two `<a>` tags on the same page pointing at
	 * the same destination count once.
	 */
	referrerCount: number;
}

/**
 * Paginated result for {@link import('./list-external-links.js').listExternalLinks}.
 */
export interface PaginatedExternalLinkList {
	/** External destination entries. */
	items: ExternalLinkEntry[];
	/** Total matching destinations (distinct count, not anchor count). */
	total: number;
	/** Current offset. */
	offset: number;
	/** Page size used. */
	limit: number;
}

/**
 * Filter options for listing resources.
 */
export interface ListResourcesOptions {
	/** URL pattern to filter resource URLs. */
	urlPattern?: string;
	/** Filter by HTTP status. */
	status?: number;
	/** Filter by content type prefix (e.g., "text/css", "application/javascript"). */
	contentType?: string;
	/** Filter by external (true) or internal (false) resources. */
	isExternal?: boolean;
	/** Field to sort results by. */
	sortBy?:
		| 'url'
		| 'status'
		| 'statusText'
		| 'contentType'
		| 'contentLength'
		| 'isExternal'
		| 'referrerCount'
		| 'compress'
		| 'cdn';
	/** Sort direction. */
	sortOrder?: SortOrder;
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
 * Filter and pagination options for {@link import('./list-viewer-resources.js').listViewerResources}
 * — the `viewer_resources` read-model-backed counterpart of
 * {@link ListResourcesOptions}.
 *
 * Deliberately narrower than {@link ListResourcesOptions}: `urlPattern`
 * (LIKE-based) and `contentType` (raw MIME prefix, not the classified
 * `content_category` the read model stores) are excluded, and `sortBy` is
 * restricted to the two columns the read model indexes — callers that need
 * anything else fall back to `listResources` instead.
 */
export interface ListViewerResourcesOptions {
	/** Filter by external (true) or internal (false) resources. */
	isExternal?: boolean;
	/** Filter by exact HTTP status code. */
	status?: number;
	/** Field to sort results by. Defaults to `'url'`. */
	sortBy?: 'url' | 'status';
	/** Sort direction. Defaults to `'asc'`. */
	sortOrder?: SortOrder;
	/** Maximum number of results to return. Defaults to 100. */
	limit?: number;
	/**
	 * Opaque keyset cursor from a previous {@link CursorPaginatedResourceList}'s
	 * `nextCursor`/`prevCursor`. Mutually exclusive with `offset` — when both
	 * are supplied, `cursor` wins. Omit for the first page.
	 */
	cursor?: string;
	/**
	 * Direction to walk from `cursor`: `'next'` (forward, default) or
	 * `'prev'` (backward). Ignored when `cursor` is omitted.
	 */
	direction?: 'next' | 'prev';
	/**
	 * Row offset for page-number jumps (MPA pagination). Mutually exclusive
	 * with `cursor`.
	 */
	offset?: number;
}

/**
 * Paginated result wrapper for {@link import('./list-viewer-resources.js').listViewerResources}
 * — {@link PaginatedResourceList} plus keyset cursors for virtual-scroll
 * continuation.
 */
export interface CursorPaginatedResourceList extends PaginatedResourceList {
	/**
	 * Opaque cursor to fetch the next page in the current sort order, or
	 * `null` when this is the last page.
	 */
	nextCursor: string | null;
	/**
	 * Opaque cursor to fetch the preceding page, or `null` when this is
	 * already the first page.
	 */
	prevCursor: string | null;
}

/**
 * Options for {@link import('./get-resource-referrers.js').getResourceReferrers}.
 */
export interface GetResourceReferrersOptions {
	/** The exact URL of the resource to look up. */
	resourceUrl: string;
	/** Maximum number of referencing pages to return. Defaults to 100. */
	limit?: number;
	/**
	 * Opaque cursor from a previous result's `nextCursor`. Forward-only
	 * (there is no `prevCursor`): the referrer detail list has no "jump to
	 * page N" or "scroll up" requirement, unlike the MPA-paginated list
	 * views.
	 */
	cursor?: string;
}

/**
 * Result of {@link import('./get-resource-referrers.js').getResourceReferrers} —
 * a bounded, cursor-paginated window of pages referencing a resource.
 */
export interface ResourceReferrerResult {
	/** The resource URL. */
	resourceUrl: string;
	/** The page URLs referencing this resource in this window, bounded to at most `limit`. */
	pageUrls: string[];
	/**
	 * Total number of referencing pages — a `COUNT(*)` scoped to this
	 * resource's `resourceId` (index-covered, always cheap regardless of
	 * archive size), independent of `pageUrls`' window length.
	 */
	total: number;
	/** Opaque cursor to fetch the next window, or `null` when this is the last one. */
	nextCursor: string | null;
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
	/** Field to sort results by. */
	sortBy?:
		| 'pageUrl'
		| 'src'
		| 'alt'
		| 'width'
		| 'height'
		| 'naturalWidth'
		| 'naturalHeight'
		| 'isLazy';
	/** Sort direction. */
	sortOrder?: SortOrder;
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
	/** URL pattern to filter page URLs. */
	urlPattern?: string;
	/** Field to sort results by. */
	sortBy?: 'url' | 'validator' | 'severity' | 'rule' | 'message' | 'code';
	/** Sort direction. */
	sortOrder?: SortOrder;
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
 * Presence flags for the four security-related HTTP response headers tracked
 * by {@link import('./check-headers.js').checkHeaders} / `listPages`, computed in SQL via
 * `headerPresenceExpression`.
 */
export interface HeaderPresence {
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
 * One failure record before aggregation, shared by the error-reader helpers
 * (`readPageErrors` / `readCrawlErrors` / `readErrorLog`) and by
 * `getErrorKinds` / `resolveFailedPageMessages` consumers.
 *
 * The cause is intentionally NOT recorded here — classification is performed
 * on read by `classifyErrorKind` so the same archive yields the same groups
 * regardless of when it was crawled.
 */
export interface ErrorRecord {
	/** URL the failure is about, or `null` when unknown / process-level. */
	url: string | null;
	/** Raw message used to classify the cause. */
	message: string;
}

/**
 * Options for {@link import('./get-error-kinds.js').getErrorKinds}.
 */
export interface GetErrorKindsOptions {
	/** Exact host to filter to — used by the detail pane's host×kind lookup. */
	host?: string;
	/** Exact kind to filter to — the list's kind column filter, or half of the detail pane's lookup key. */
	kind?: ErrorKind;
	/** Field to sort results by. */
	sortBy?: 'host' | 'kind' | 'count';
	/** Sort direction. Defaults to `desc` when sorting by `count`, `asc` otherwise. */
	sortOrder?: SortOrder;
	/** Maximum rows to return. Omit to return every matching row (the CLI's whole-archive contract). */
	limit?: number;
	/** Rows to skip from the start. Defaults to 0. */
	offset?: number;
}

/**
 * One host×kind row — every distinct (host, kind) pair present in the
 * archive's failure records gets exactly one row.
 */
export interface ErrorKindEntry {
	/** Hostname extracted from the failing URL, or `(unknown)` / `(invalid)` sentinels. */
	host: string;
	/** The classified cause shared by every failure in this row. */
	kind: ErrorKind;
	/** Total failure records for this host×kind pair. */
	count: number;
	/** Up to a capped number of representative failing URLs for this pair (see `getErrorKinds`). */
	sampleUrls: string[];
	/** Failure records for this pair beyond the `sampleUrls` cap; `0` means none were dropped. */
	overflowedCount: number;
}

/**
 * Archive-wide totals accompanying {@link ErrorKindsResult.items} — computed
 * before the `host`/`kind` filters are applied, so the summary line above the
 * list stays stable while the user filters.
 */
export interface ErrorKindFacets {
	/** Total failure records across the whole archive, ignoring `host`/`kind` filters. */
	totalRecords: number;
	/**
	 * Where the error-channel (DNS/connection/TLS) records came from:
	 * `crawl_errors` for archives crawled after structured capture landed,
	 * `error.log` for older archives parsed on read, or `none` when neither
	 * yielded rows. `page_errors` (scrape-path) is always merged in regardless.
	 */
	channelSource: 'crawl_errors' | 'error.log' | 'none';
}

/** Result of {@link import('./get-error-kinds.js').getErrorKinds}. */
export interface ErrorKindsResult {
	/** Matching host×kind rows for the requested page. */
	items: ErrorKindEntry[];
	/** Total matching rows before `limit`/`offset` slicing (drives the list's pagination). */
	total: number;
	/** Archive-wide totals, unaffected by `host`/`kind` filters. */
	facets: ErrorKindFacets;
}

/**
 * Progress snapshot reported while {@link buildViewerReadModel} populates
 * `viewer_pages`. Issued after each insert chunk completes, so callers can
 * render a percentage or row count for archives large enough (issue #112:
 * 400k pages take minutes) that a build must not look hung.
 */
export interface ViewerReadModelBuildProgress {
	/** Rows inserted into `viewer_pages` so far, including this chunk. */
	insertedRows: number;
	/** Total rows that will be inserted, known upfront (single-pass build). */
	totalRows: number;
}

/**
 * Options for {@link buildViewerReadModel} and {@link ensureViewerReadModel}.
 */
export interface BuildViewerReadModelOptions {
	/**
	 * Called after each `viewer_pages` insert chunk completes. Omit to build
	 * silently (the default for callers that don't need progress, e.g. tests).
	 * @param progress - The current insert progress.
	 */
	onProgress?: (progress: ViewerReadModelBuildProgress) => void;
}

/**
 * Options for {@link ensureViewerReadModelOpportunistically}.
 */
export interface EnsureViewerReadModelOpportunisticallyOptions extends BuildViewerReadModelOptions {
	/**
	 * Warning sink invoked when the build is skipped (another process/tab
	 * already holds the build lock) or fails outright. Defaults to a no-op —
	 * callers that want the message surfaced (viewer, MCP, query CLI) should
	 * pass their own sink, mirroring {@link ArchiveManagerWarn}. Never called
	 * for the common case (read model already current, nothing to build).
	 * @param message - A human-readable description of what was skipped or failed.
	 */
	onWarn?: (message: string) => void;
}

/**
 * One flat node in a directory tree, as returned by {@link getDirectoryTree}
 * and {@link listDirectoryChildren}. `parentNodeId` is the only structural
 * link — callers reconstruct the nested UI tree client-side from this flat
 * list, since neither endpoint recurses server-side.
 */
export interface DirectoryTreeNode {
	/** This node's unique id — stable across `getDirectoryTree`/`listDirectoryChildren` calls. */
	nodeId: number;
	/** The parent directory's `nodeId`, or `null` for a host's root node. */
	parentNodeId: number | null;
	/** This node's own path segment (e.g. `"2024"` for `/blog/2024/`), or `''` for a host's root node. */
	name: string;
	/** This node's full path from the root (e.g. `/blog/2024/`, or `/` for a root node). */
	path: string;
	/** This node's depth — a host's root node is `0`, incrementing by 1 per path segment. */
	depth: number;
	/** Count of immediate child directory nodes (not pages) under this node. */
	directChildDirCount: number;
	/** Count of pages attached directly to this node. */
	directPageCount: number;
	/**
	 * `directChildDirCount + directPageCount`. The two addends are
	 * precomputed at read-model build time; the sum itself is a trivial O(1)
	 * SQL addition over those two already-fetched columns at query time —
	 * never a `COUNT`/`GROUP BY` scan over `viewer_directory_nodes` or
	 * `viewer_directory_pages`.
	 */
	childCount: number;
	/** Total pages in this node's entire subtree, including its own `directPageCount`. */
	descendantPageCount: number;
	/** Subset of `descendantPageCount` that is internal (in-scope). */
	internalDescendantPageCount: number;
	/** Subset of `descendantPageCount` that is external (out-of-scope). */
	externalDescendantPageCount: number;
	/**
	 * `true` iff `directChildDirCount > 0` — whether this node has child
	 * directories to expand via `listDirectoryChildren`/
	 * `/api/directory-tree/children`. Deliberately excludes `directPageCount`
	 * — direct pages surface via the separate `/api/directory-tree/pages`
	 * panel, not as additional expandable tree rows.
	 */
	hasChildren: boolean;
}

/** One host's worth of initial (depth ≤ 3) directory-tree nodes — see {@link getDirectoryTree}. */
export interface DirectoryTreeRoot {
	/** The host (hostname:port) this tree belongs to. */
	rootKey: string;
	/** This root's flat, depth ≤ 3 node list, ordered by path. */
	nodes: DirectoryTreeNode[];
}

/** Options for {@link listDirectoryChildren}. */
export interface ListDirectoryChildrenOptions {
	/** The parent node whose direct child directories to list. */
	nodeId: number;
	/** Defensive cap on returned rows. Defaults to 1000 — not a pagination contract, a directory realistically never has more child directories than this. */
	limit?: number;
}

/** One directory-tree page-list entry, joined against `viewer_pages` for display — see {@link listDirectoryPages}. */
export interface DirectoryPageListItem {
	/** The page's id. */
	pageId: number;
	/** The page's absolute URL. */
	url: string;
	/** The page's `<title>` text, or `null` when absent. */
	title: string | null;
	/** HTTP status code, or `null` for not-yet-classified/errored rows. */
	status: number | null;
	/** The page's {@link ContentTypeCategory}. */
	contentCategory: string;
}

/** Options for {@link listDirectoryPages}. */
export interface ListDirectoryPagesOptions {
	/** The directory node whose direct pages to list (never its descendants). */
	nodeId: number;
	/**
	 * Opaque cursor from a previous {@link CursorPaginatedDirectoryPageList}'s
	 * `nextCursor`. Omit for the first page.
	 */
	cursor?: string;
	/** Maximum number of results to return. Defaults to 100. */
	limit?: number;
}

/**
 * Cursor-paginated result of {@link listDirectoryPages}. Forward-only (no
 * `prevCursor`) — unlike {@link CursorPaginatedPageList}, this endpoint has
 * no virtual-scroll-upward requirement to support.
 */
export interface CursorPaginatedDirectoryPageList {
	/** The page-list items for this page. */
	items: DirectoryPageListItem[];
	/** Opaque cursor to fetch the next page, or `null` when this is the last page. */
	nextCursor: string | null;
}

/**
 * The subset of {@link import('@d-zero/shared/parse-url').ExURL} fields that
 * {@link import('./compare-url-sort-keys.js').compareUrlSortKeys} needs,
 * extracted immediately after parsing so the full `ExURL` (which carries
 * several fields the comparator never reads, e.g. `username`/`password`/
 * `port`/`depth`/`dirname`/`stem`) is not retained for every URL in a
 * large archive.
 */
export interface UrlSortKey {
	/** The original input URL string, used for the equal-`href` tiebreak and for the final `url` → rank lookup. */
	original: string;
	/** {@link import('@d-zero/shared/parse-url').ExURL.href}. */
	href: string;
	/** {@link import('@d-zero/shared/parse-url').ExURL.hostname}. */
	hostname: string;
	/** {@link import('@d-zero/shared/parse-url').ExURL.paths}. */
	paths: string[];
	/** {@link import('@d-zero/shared/parse-url').ExURL.basename}, defaulted to `''`. */
	basename: string;
	/** {@link import('@d-zero/shared/parse-url').ExURL.isIndex}. */
	isIndex: boolean;
	/** {@link import('@d-zero/shared/parse-url').ExURL.extname}, defaulted to `''`. */
	extname: string;
	/** {@link import('@d-zero/shared/parse-url').ExURL.query}, defaulted to `''`. */
	search: string;
	/** {@link import('@d-zero/shared/parse-url').ExURL.hash}, defaulted to `''`. */
	hash: string;
	/** {@link import('@d-zero/shared/parse-url').ExURL.protocol}. */
	protocol: string;
}
