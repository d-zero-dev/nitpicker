import type { ProgressEvent } from '@d-zero/page-cluster/resolve-page-cluster-keys';
import type { Archive, Page, TemplateClusterReason } from '@nitpicker/crawler';

/**
 * Options for {@link import('./classify-page-templates.js').classifyPageTemplates}.
 */
export interface ClassifyPageTemplatesOptions {
	/** The archive to read pages/stylesheets from and to derive the cache key from. */
	archive: Archive;
	/**
	 * All pages already loaded for this `analyze()` run (see
	 * `Nitpicker.analyze`'s accumulation across `getPagesWithRefs` batches —
	 * classification must run once, globally, not per batch).
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
	onProgress?: (event: ProgressEvent) => void;
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
