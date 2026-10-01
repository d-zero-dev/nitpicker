import type { viewerTableFeatures } from './table-features.js';
import type {
	ListPagesOptions,
	TemplateClusterLandmarkSummary,
	TemplateClusterSummary,
} from '@nitpicker/query';
import type {
	CellContext as TanstackCellContext,
	ColumnDef as TanstackColumnDef,
} from '@tanstack/react-table';

/**
 * {@link TanstackColumnDef} pinned to {@link viewerTableFeatures} — every view
 * that builds table columns imports this instead of the raw TanStack type, so
 * a single feature set change here does not require touching every call
 * site's type arguments.
 */
export type ColumnDef<TData, TValue = unknown> = TanstackColumnDef<
	typeof viewerTableFeatures,
	TData,
	TValue
>;

/** {@link TanstackCellContext} pinned to {@link viewerTableFeatures} — see {@link ColumnDef}. */
export type CellContext<TData, TValue = unknown> = TanstackCellContext<
	typeof viewerTableFeatures,
	TData,
	TValue
>;

/**
 * Page-list filter state (everything except pagination, which the hook
 * owns). Every checkbox-driven field accepts a repeated array of raw
 * query-string values (multi-select checkbox, OR'd server-side) in addition
 * to `ListPagesOptions`'s single value — the server's
 * `toMultiValue`/`toNumber`/`toContentTypeCategory`/`toBoolean` parse each
 * array element, so the client sends strings rather than pre-converting
 * (matching every other list view's filter type, e.g. `ResourcesFilter`).
 */
export type PagesFilter = Omit<
	ListPagesOptions,
	| 'limit'
	| 'offset'
	| 'status'
	| 'contentTypeCategory'
	| 'templateKey'
	| 'isExternal'
	| 'lang'
	| 'missingTitle'
	| 'hasCSP'
	| 'hasXFrameOptions'
	| 'hasXContentTypeOptions'
	| 'hasHSTS'
	| 'imageScan'
	| 'isDedupeCapped'
> & {
	status?: string | readonly string[];
	contentTypeCategory?: string | readonly string[];
	templateKey?: string | readonly string[];
	isExternal?: string | readonly string[];
	lang?: string | readonly string[];
	missingTitle?: string | readonly string[];
	hasCSP?: string | readonly string[];
	hasXFrameOptions?: string | readonly string[];
	hasXContentTypeOptions?: string | readonly string[];
	hasHSTS?: string | readonly string[];
	imageScan?: string | readonly string[];
	isDedupeCapped?: string | readonly string[];
};

/**
 * Analysis violation entry, mirroring the API response shape.
 *
 * Defined here because `@nitpicker/query` keeps `ViolationEntry` internal
 * (not exported from its public surface).
 */
export interface ViolationEntry {
	/** The page URL. */
	url: string;
	/** The validator that produced this violation (axe, markuplint, etc.). */
	validator: string;
	/** The severity level. */
	severity: string;
	/** The rule ID. */
	rule: string;
	/** The violation message. */
	message: string;
	/** The source code snippet or element selector. */
	code: string;
}

/**
 * Result of querying which pages reference a resource.
 *
 * Mirrors the API response (`@nitpicker/query` keeps this type internal).
 */
export interface ResourceReferrerResult {
	/** The queried resource URL. */
	resourceUrl: string;
	/** URLs of pages referencing the resource. */
	pageUrls: string[];
	/** Total number of referring pages. */
	total: number;
}

/** Result of fetching a stored HTML snapshot. */
export interface PageHtmlResult {
	/** The (possibly truncated) HTML source. */
	html: string;
	/** Whether the HTML was truncated to the requested max length. */
	truncated: boolean;
}

/** A navigation entry in the sidebar. */
export interface NavItem {
	/** The client route path. */
	path: string;
	/** The i18n key for the display label (under `nav.`). */
	labelKey: string;
}

/** Supported UI locales. */
export type Locale = 'en' | 'ja';

/** The i18n context value: current locale, a setter, and the translate function. */
export interface I18nValue {
	/** The active locale. */
	locale: Locale;
	/** Switches the active locale. */
	setLocale: (locale: Locale) => void;
	/**
	 * Translates a dot-separated key (e.g. `views.pages.title`) for the active
	 * locale. Returns the key itself if no translation is found. Occurrences of
	 * `{name}` in the value are replaced with `params.name`.
	 */
	t: (key: string, params?: Record<string, string | number>) => string;
}

/** One segment of a text diff. */
export interface DiffSegment {
	/** The text of this segment. */
	value: string;
	/** Whether the segment is unchanged, removed (actual-only), or added (expected-only). */
	type: 'common' | 'removed' | 'added';
}

/** A character-level diff between two strings, split per side. */
export interface DiffResult {
	/** Segments for the actual value (with `removed` middle). */
	actual: DiffSegment[];
	/** Segments for the expected value (with `added` middle). */
	expected: DiffSegment[];
}

/**
 * Pagination mode for list views.
 *
 * `'mpa'` — classic per-page table with Prev/Next + page number controls and
 * the current page encoded in the URL (`?page=N`). The default mode; lets
 * operators deep-link, share URLs, and use the browser back button.
 *
 * `'virtual'` — windowed (virtualized) infinite scroll backed by
 * `useInfiniteQuery`. Best when bouncing through 100k+ rows with the keyboard
 * and not needing a shareable position.
 */
export type PaginationMode = 'mpa' | 'virtual';

/**
 * Allowed page-size values for MPA pagination, in ascending order (also the
 * `<select>` option order). Declared as the single source of truth for
 * {@link PageSize} — `use-page-size.ts` and `parse-page-size.ts` both derive
 * from this array instead of independently re-listing the same six numbers,
 * so adding/removing a size can't update one and silently miss the other.
 */
export const PAGE_SIZE_OPTIONS = [50, 100, 200, 500, 750, 1000] as const;

/**
 * One of {@link PAGE_SIZE_OPTIONS}. The default is `100` (matches the
 * historical `PAGE_SIZE` used by virtual-mode infinite queries).
 */
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

/**
 * Directory-tree sibling ordering. `'path'` is the backend's native order
 * (`path_sort_key`) and requires no client-side reordering; the page-count
 * orders are computed purely from `descendantHtmlPageCount`, already present
 * on every node, so no additional request is needed.
 */
export type DirectoryTreeSortOrder = 'path' | 'pagesDesc' | 'pagesAsc';

/** Which source `buildClusterHeading` drew a template cluster's heading from. */
export type ClusterHeadingSource = 'distinctive' | 'common' | 'directory' | 'raw';

/** A landmark type (`header`/`footer`/`nav`/`aside`/`form`/`search`). */
export type ClusterLandmarkType = TemplateClusterLandmarkSummary['type'];

/** Page-count bucket label used by the template cluster size distribution. */
export type ClusterSizeBucketKey = 'single' | 'small' | 'medium' | 'large';

/** One bucket of the template cluster size distribution. */
export interface ClusterSizeBucket {
	/** Which page-count range this bucket covers (`1` / `2–5` / `6–20` / `21+`). */
	key: ClusterSizeBucketKey;
	/** Number of clusters whose `pageCount` falls in the range. */
	clusterCount: number;
	/** Sum of `pageCount` over those clusters. */
	pageCount: number;
}

/** One landmark type's aggregate across every cluster that carries it. */
export interface ClusterLandmarkOverview {
	/** The landmark type this row aggregates. */
	type: ClusterLandmarkType;
	/** Number of clusters whose `reason.landmarks` includes this type. */
	clusterCount: number;
	/**
	 * Page-count-weighted mean of `presenceRate` over clusters that carry a
	 * `reason` (clusters without one have unknown presence and are excluded
	 * from the denominator), 0–1.
	 */
	averagePresenceRate: number;
}

/** Aggregates shown in the summary panel at the top of the template clusters view. */
export interface TemplateClusterOverview {
	/** Total number of clusters. */
	clusterCount: number;
	/** Sum of every cluster's `pageCount`. */
	totalPageCount: number;
	/** Number of clusters with exactly one page. */
	singletonClusterCount: number;
	/** The largest clusters by `pageCount`, descending. */
	topClusters: TemplateClusterSummary[];
	/** Size distribution, always four buckets in ascending range order. */
	sizeBuckets: ClusterSizeBucket[];
	/** One row per landmark type that at least one cluster carries, in stable type order. */
	landmarks: ClusterLandmarkOverview[];
}

/** One cluster's membership in a landmark group. */
export interface LandmarkClusterGroupEntry {
	/** The cluster carrying the landmark. */
	cluster: TemplateClusterSummary;
	/** This cluster's commonality summary for the group's landmark type. */
	landmark: TemplateClusterLandmarkSummary;
}

/** Every cluster carrying one landmark type. */
export interface LandmarkClusterGroup {
	/** The landmark type shared by `entries`. */
	type: ClusterLandmarkType;
	/** Clusters carrying `type`, sorted by `pageCount` descending. */
	entries: LandmarkClusterGroupEntry[];
}
