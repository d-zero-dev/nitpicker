import type {
	ContentRootHint,
	TemplateClassificationRun,
	TemplateClusterReason,
	TemplatePageHtml,
	TemplateSampledBlock,
} from '@nitpicker/core/types';

/**
 * One page as `resolvePageClusterKeys` reads it: the blocking signals, read
 * on every pass, and the HTML, read only on the passes that use the page.
 */
export interface PageClusterPage {
	/** The page URL's path segments (`ExURL.paths`). */
	readonly paths: readonly string[];
	/** Absolute hrefs of the page's stylesheets. */
	readonly stylesheetHrefs: readonly string[];
	/**
	 * The page URL's host (hostname, optionally `:port` — `new URL(pageUrl).host`).
	 * Stylesheets on other hosts take no part in blocking.
	 */
	readonly host?: string;
	/**
	 * Identity of the page's content-root element, as a crawler detected it.
	 * Anchors the per-block content depth cap on sites without
	 * `<main>`/`role="main"`; without it the cap falls back to
	 * `<main>`/`role="main"` and then the built-in `#main`, `#content`, … list.
	 */
	readonly contentRoot?: ContentRootHint;
	/**
	 * The page's HTML, non-empty. Called only on the reads that use the page
	 * (every page of a block clustered whole, and the sampled pages of a
	 * sampled block, on the first read; the other pages of the sampled blocks
	 * on the second), so a page's HTML is decompressed once however many
	 * times the corpus is read.
	 */
	getHtml(): string | Promise<string>;
}

/**
 * Factory returning an iterator over the corpus. Called once per read — the
 * signals, then the HTML, and, when a block was sampled, the HTML again for
 * the pages outside the samples. Every call must yield the same pages in the
 * same order; a corpus that changes size between reads is rejected.
 *
 * A factory rather than an `AsyncIterable`: one returned once cannot be
 * traversed a second time, while a factory lets the caller re-issue its
 * archive query per read, so no read holds the corpus's HTML at once.
 */
export type PageFactory = () =>
	Iterable<PageClusterPage> | AsyncIterable<PageClusterPage>;

/**
 * Progress of `resolvePageClusterKeys`, a union on `phase`:
 * - `pass0-signals`: reading the blocking signals; every 1,000 pages.
 * - `block-sampled`: a block will be clustered from a sample, because its
 *   similarity table exceeds the memory budget or because the blocks
 *   clustered whole would hold more than `@nitpicker/core`'s
 *   `TEMPLATE_EXACT_PAGE_LIMIT` pages and it is among the largest; once per
 *   such block, before any HTML is read.
 * - `pass1-block-complete`: one block's clusters are done.
 * - `pass1b-assign`: only with a sampled block; every 1,000 pages assigned to
 *   the sampled clusters.
 * - `stage-b-start`: the merge across blocks began; once per call.
 */
export type ProgressEvent =
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

/** Options of `resolvePageClusterKeys`. */
export interface ResolvePageClusterKeysOptions {
	/**
	 * Bytes a block's Stage A similarity table may take before the block is
	 * clustered from a sample instead (`@nitpicker/core`'s
	 * `TEMPLATE_MEMORY_BUDGET` by default; `0` samples every block).
	 */
	readonly memoryBudget: number;
	/** Receives every {@link ProgressEvent}. */
	readonly onProgress: (event: ProgressEvent) => void;
}

/** What `resolvePageClusterKeys` returns. */
export interface PageClusterKeys {
	/** Each page's cluster key, in corpus order. */
	readonly keys: string[];
	/**
	 * Each final cluster's reason, by key. Built from the clusters' retained
	 * members (the samples, for a sampled block), sized by cluster count, not
	 * page count.
	 */
	readonly reasons: ReadonlyMap<string, TemplateClusterReason>;
	/** The blocks clustered from a sample, in block order. */
	readonly sampledBlocks: readonly TemplateSampledBlock[];
}

/** One read of the corpus's HTML, as the driver hands it to the run. */
export interface HtmlRead {
	/** The corpus. */
	readonly pages: PageFactory;
	/**
	 * The run's `pageMask()` for this read: which pages it uses; its length
	 * is the page count of the first read.
	 */
	readonly mask: Uint8Array;
	/** Hands a batch to the run (`pushPages` or `pushAssignmentPages`). */
	readonly push: (batch: TemplatePageHtml[]) => Promise<void>;
}

/** The read of every page's blocking signals into a run. */
export interface SignalsRead {
	/** The corpus. */
	readonly pages: PageFactory;
	/** The run the signals go to. */
	readonly run: TemplateClassificationRun;
	/** Receives the `pass0-signals` events. */
	readonly onProgress: ((event: ProgressEvent) => void) | undefined;
}
