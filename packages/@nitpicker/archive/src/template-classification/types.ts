import type Archive from '../archive.js';
import type { TemplateClusterReason } from '../db-ops/templates/types.js';
import type Page from '../page.js';

/**
 * Progress of the clustering step itself. A copy of the page-cluster
 * engine's `ProgressEvent` (`./page-cluster/resolve-page-cluster-keys.ts`,
 * structurally assignable to this type), kept independent of it so
 * `@nitpicker/cli` formats progress against a type archive exports rather
 * than against the engine's internals, which are not part of archive's
 * `exports` — the same reason {@link TemplateClusterReason} mirrors
 * `ClusterReason`.
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
	 * Progress callback forwarded to the page-cluster engine's
	 * `resolvePageClusterKeys`, so long-running classification on large
	 * archives isn't silently unresponsive. Independent of cluster-reason
	 * capture — `resolvePageClusterKeys` composes `onProgress` and
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
	 * Template key → page-cluster's cluster-selection evidence for
	 * that key. **Not guaranteed to cover every key in `templateKeysByUrl`**:
	 * page-cluster only emits a reason for a final cluster it still
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
