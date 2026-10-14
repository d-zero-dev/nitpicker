import type Archive from '../archive.js';
import type { TemplateClusterReason } from '../db-ops/templates/types.js';
import type { ContentRootHint } from '@nitpicker/core/types';

/**
 * The four values of a page's detected main-content element that
 * `createContentRootHint` builds the classifier's content-root hint from.
 * Structurally the matching getters of `Page`, and the decoded
 * `page_meta.main_content_*` columns `loadPageClusterCandidates` reads.
 */
export interface ContentRootSource {
	/** The element's DOM node name (`'DIV'`), or `null`. */
	readonly mainContentNodeName: string | null;
	/** The element's `id`, or `null`. */
	readonly mainContentId: string | null;
	/** The element's `role`, or `null`. */
	readonly mainContentRole: string | null;
	/** The element's CSS classes, or `null` when no main region was detected. */
	readonly mainContentClassList: readonly string[] | null;
}

/**
 * What template classification keeps of one internal HTML page while it
 * waits for the clustering: the page's id (to read its HTML by) and the
 * signals the classifier reads without HTML. Deliberately not a `Page` — a
 * `Page` holds the page's whole row (every meta column), and holding one per
 * page of a several-hundred-thousand-page archive is what this type avoids.
 * @example
 * ```ts
 * const candidate: PageClusterCandidate = {
 * 	id: 12,
 * 	href: 'https://example.com/news/1',
 * 	paths: ['news', '1'],
 * 	host: 'example.com',
 * };
 * ```
 */
export interface PageClusterCandidate {
	/** `Page.id`; the key the page's HTML is read by. */
	readonly id: number;
	/** The page's `url.href`; the key of its result and of its stylesheet references. */
	readonly href: string;
	/** The page's URL path segments. */
	readonly paths: readonly string[];
	/** `hostname`, or `hostname:port` when the URL has a port. */
	readonly host: string;
	/** The crawler-detected main-content hint; absent when none was detected. */
	readonly contentRoot?: ContentRootHint;
}

/**
 * Progress of the clustering step itself. A copy of the page-cluster
 * driver's `ProgressEvent` (`./page-cluster/resolve-page-cluster-keys.ts`,
 * structurally assignable to this type), kept independent of it so
 * `@nitpicker/cli` formats progress against a type archive exports rather
 * than against the driver's internals, which are not part of archive's
 * `exports` — the same reason {@link TemplateClusterReason} mirrors
 * `@nitpicker/core`'s reason type.
 */
export type TemplateClusteringProgress =
	| { readonly phase: 'pass0-signals'; readonly pagesSeen: number }
	| {
			readonly phase: 'block-sampled';
			readonly blockKey: string;
			readonly pageCount: number;
			readonly pairBytes: number;
			readonly budget: number;
			readonly reason: 'table-over-budget' | 'pages-over-limit';
	  }
	| {
			readonly phase: 'pass1-block-complete';
			readonly blockKey: string;
			readonly blocksProcessed: number;
			readonly totalBlocks: number;
	  }
	| {
			readonly phase: 'pass1b-assign';
			readonly pagesAssigned: number;
			readonly pagesToAssign: number;
	  }
	| { readonly phase: 'stage-b-start'; readonly unitCount: number };

/**
 * Progress of the whole crawl-end classification
 * ({@link import('./classify-archive-page-templates.js').classifyArchivePageTemplates}):
 * listing the pages with stored HTML, loading their signals out of the
 * archive, gathering stylesheet references, the clustering phases, then
 * writing the result.
 *
 * `loading-pages-start`, `collecting-stylesheets`, `listing-html-snapshots`
 * and `writing-results` carry no count: each is a step with no natural
 * progress unit (a count query followed by keyset batches that report their
 * own `loading-pages` counts, three chained SQL passes, one join query, one
 * write transaction), so they only announce that the step began — otherwise
 * the previous step's last message would stay on screen and look like a stall.
 */
export type TemplateClassificationProgress =
	| { readonly phase: 'loading-pages-start' }
	| { readonly phase: 'loading-pages'; readonly done: number; readonly total: number }
	| { readonly phase: 'collecting-stylesheets' }
	| { readonly phase: 'listing-html-snapshots' }
	| TemplateClusteringProgress
	| { readonly phase: 'writing-results'; readonly templateCount: number };

/**
 * A block clustered from a sample of its pages. Mirrors `@nitpicker/core`'s
 * `TemplateSampledBlock`, for the same reason {@link TemplateClusterReason}
 * mirrors its reason type.
 * @example
 * ```ts
 * const block: SampledTemplateBlock = {
 * 	blockKey: 'path:news',
 * 	pageCount: 30_000,
 * 	pairBytes: 3_599_880_000,
 * 	reason: 'table-over-budget',
 * };
 * ```
 */
export interface SampledTemplateBlock {
	/** The block's key. */
	readonly blockKey: string;
	/** Its pages. */
	readonly pageCount: number;
	/** Bytes its similarity table would have taken. */
	readonly pairBytes: number;
	/**
	 * Why it was sampled: its table exceeds the memory budget, or the blocks
	 * clustered whole would hold more than `@nitpicker/core`'s
	 * `TEMPLATE_EXACT_PAGE_LIMIT` pages and it is among the largest.
	 */
	readonly reason: 'table-over-budget' | 'pages-over-limit';
}

/**
 * Options for {@link import('./classify-page-templates.js').classifyPageTemplates}.
 */
export interface ClassifyPageTemplatesOptions {
	/** The archive to read stylesheet references and the stored-HTML listing from. */
	archive: Archive;
	/**
	 * Every internal HTML page of the archive that has a stored HTML snapshot
	 * (`loadPageClusterCandidates`).
	 * Classification is a corpus-wide batch computation: template keys are
	 * only comparable within one call, so the pages must never be passed in
	 * per-batch slices.
	 */
	candidates: readonly PageClusterCandidate[];
	/**
	 * Bytes a block's Stage A similarity table may take before the block is
	 * clustered from a sample instead; see `resolvePageClusterKeys`. Defaults
	 * to `@nitpicker/core`'s `TEMPLATE_MEMORY_BUDGET`; `0` samples every block.
	 */
	memoryBudget?: number;
	/**
	 * Receives every {@link TemplateClassificationProgress} event of the call,
	 * including the clustering phases `resolvePageClusterKeys` reports, so
	 * long-running classification on large archives isn't silently
	 * unresponsive.
	 */
	onProgress?: (event: TemplateClassificationProgress) => void;
}

/**
 * Options for {@link import('./load-page-cluster-candidates.js').loadPageClusterCandidates}.
 */
export interface LoadPageClusterCandidatesOptions {
	/**
	 * Output of `collectPageIdsWithHtml`: only pages whose id is in it are
	 * loaded, so pages with no stored HTML never take part (nor stay resident).
	 */
	readonly pageIdsWithHtml: ReadonlySet<number>;
	/** Receives a `loading-pages` event after each batch. */
	readonly onProgress?: (event: TemplateClassificationProgress) => void;
	/** Rows read per query. Defaults to 10,000; a bound on one query's transient garbage only. */
	readonly batchSize?: number;
}

/**
 * Options for {@link import('./create-page-cluster-factory.js').createPageClusterFactory}.
 */
export interface CreatePageClusterFactoryOptions {
	/** Reads each page's HTML by id, only on the reads that use it. */
	readonly archive: Pick<Archive, 'getHtmlOfPage'>;
	/**
	 * The pages to cluster, as `loadPageClusterCandidates` returned them
	 * (already limited to pages with a stored HTML snapshot).
	 */
	readonly candidates: readonly PageClusterCandidate[];
	/** Output of `collectPageStylesheetUrls`, keyed by `url.href`. */
	readonly stylesheetsByUrl: ReadonlyMap<string, readonly string[]>;
}

/**
 * Result of {@link import('./classify-page-templates.js').classifyPageTemplates}.
 */
export interface PageTemplateClassification {
	/**
	 * Page URL (`page.url.href`) → template key. Only internal HTML pages
	 * with retrievable HTML have an entry.
	 */
	readonly templateKeysByUrl: ReadonlyMap<string, string>;
	/**
	 * Template key → the classifier's cluster-selection evidence for that
	 * key, one per final cluster. Built from each cluster's retained members
	 * (the samples, for a sampled block), so `memberCount` can be smaller
	 * than the cluster's page count.
	 */
	readonly clusterReasonsByTemplateKey: ReadonlyMap<string, TemplateClusterReason>;
	/** The blocks clustered from a sample, in block order. */
	readonly sampledBlocks: readonly SampledTemplateBlock[];
}

/**
 * Options for {@link import('./classify-archive-page-templates.js').classifyArchivePageTemplates}.
 */
export interface ClassifyArchivePageTemplatesOptions {
	/**
	 * Bytes a block's Stage A similarity table may take before the block is
	 * clustered from a sample instead; see `resolvePageClusterKeys`. Defaults
	 * to `@nitpicker/core`'s `TEMPLATE_MEMORY_BUDGET`; `0` samples every block.
	 */
	readonly memoryBudget?: number;
	/** Receives loading and clustering progress; omit for a silent run. */
	readonly onProgress?: (event: TemplateClassificationProgress) => void;
}

/**
 * Result of {@link import('./classify-archive-page-templates.js').classifyArchivePageTemplates}.
 */
export interface ClassifyArchivePageTemplatesResult {
	/** Number of pages that received a template key. */
	readonly classifiedPageCount: number;
	/** Number of distinct template keys among them. */
	readonly templateCount: number;
	/** The blocks clustered from a sample, in block order; empty when none was. */
	readonly sampledBlocks: readonly SampledTemplateBlock[];
}
