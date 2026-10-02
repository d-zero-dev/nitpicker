import type Archive from '../archive/archive.js';
import type { TemplateClusterReason } from '../archive/db-ops/templates/types.js';
import type Page from '../archive/page.js';

/**
 * Progress of the clustering step itself. nitpicker's own copy of
 * `@d-zero/page-cluster`'s `ProgressEvent` (which is structurally assignable
 * to this type), kept independent of that package so `@nitpicker/cli` can
 * format progress without depending on `@d-zero/page-cluster` — the same
 * reason {@link TemplateClusterReason} mirrors `ClusterReason`.
 */
export type TemplateClusteringProgress =
	| { readonly phase: 'pass0-signals'; readonly pagesSeen: number }
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
 * references, the clustering phases, then writing the result.
 *
 * `loading-pages-start`, `collecting-stylesheets` and `writing-results` carry
 * no count: each is a multi-second step with no natural progress unit (a
 * single batched query, three chained SQL passes, one write transaction), so
 * they only announce that the step began — otherwise the previous step's last
 * message would stay on screen and look like a stall.
 */
export type TemplateClassificationProgress =
	| { readonly phase: 'loading-pages-start' }
	| { readonly phase: 'loading-pages'; readonly done: number; readonly total: number }
	| { readonly phase: 'collecting-stylesheets' }
	| TemplateClusteringProgress
	| { readonly phase: 'writing-results'; readonly templateCount: number };

/**
 * Options for {@link import('./classify-page-templates.js').classifyPageTemplates}.
 */
export interface ClassifyPageTemplatesOptions {
	/** The archive to read stylesheet references from. */
	archive: Archive;
	/**
	 * Every page of the archive. Classification is a corpus-wide batch
	 * computation: template keys are only comparable within one call, so the
	 * pages must never be passed in per-batch slices.
	 */
	pages: readonly Page[];
	/**
	 * Progress callback forwarded to `@d-zero/page-cluster`'s
	 * `resolvePageClusterKeys`, so long-running classification on large
	 * archives isn't silently unresponsive. Independent of cluster-reason
	 * capture — `@d-zero/page-cluster` 0.5.3+ composes `onProgress` and
	 * `onClusterReason` without either one demoting the corpus off its
	 * progress-emitting path (see `classifyPageTemplates`'s own JSDoc).
	 */
	onProgress?: (event: TemplateClassificationProgress) => void;
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
	 * Template key → `@d-zero/page-cluster`'s cluster-selection evidence for
	 * that key. **Not guaranteed to cover every key in `templateKeysByUrl`**:
	 * `@d-zero/page-cluster` only emits a reason for a final cluster it still
	 * holds full grouping state for at the moment `onClusterReason` fires,
	 * which is a best-effort side channel rather than a per-page guarantee
	 * (unlike `templateKeysByUrl`, which is verified 1:1 against the yielded
	 * page set — see the hard length check in `classifyPageTemplates`).
	 */
	readonly clusterReasonsByTemplateKey: ReadonlyMap<string, TemplateClusterReason>;
}

/**
 * Options for {@link import('./classify-archive-page-templates.js').classifyArchivePageTemplates}.
 */
export interface ClassifyArchivePageTemplatesOptions {
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
}
