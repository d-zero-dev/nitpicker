import type Archive from '../archive.js';
import type { TemplateClusterReason } from '../db-ops/templates/types.js';
import type Page from '../page.js';

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
 * loading every page handle out of the archive, gathering stylesheet
 * references, listing the pages with stored HTML, the clustering phases,
 * then writing the result.
 *
 * `loading-pages-start`, `collecting-stylesheets`, `listing-html-snapshots`
 * and `writing-results` carry no count: each is a step with no natural
 * progress unit (a single batched query, three chained SQL passes, one join
 * query, one write transaction), so they only announce that the step began —
 * otherwise the previous step's last message would stay on screen and look
 * like a stall.
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
	 * Every page of the archive. Classification is a corpus-wide batch
	 * computation: template keys are only comparable within one call, so the
	 * pages must never be passed in per-batch slices.
	 */
	pages: readonly Page[];
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
 * Options for {@link import('./create-page-cluster-factory.js').createPageClusterFactory}.
 */
export interface CreatePageClusterFactoryOptions {
	/**
	 * Candidate pages, as already loaded by `classifyArchivePageTemplates`
	 * (the factory does not re-query the archive).
	 */
	readonly pages: readonly Page[];
	/** Output of `collectPageStylesheetUrls`, keyed by `page.url.href`. */
	readonly stylesheetsByUrl: ReadonlyMap<string, readonly string[]>;
	/** Output of `collectPageIdsWithHtml`. */
	readonly pageIdsWithHtml: ReadonlySet<number>;
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
