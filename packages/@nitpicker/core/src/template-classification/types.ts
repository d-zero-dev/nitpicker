import type {
	ProgressEvent,
	ResolvePageClusterKeysOptions,
} from '@d-zero/page-cluster/resolve-page-cluster-keys';
import type { Archive, Page } from '@nitpicker/crawler';

/**
 * Structured explanation of why a final cluster's member pages ended up
 * together — see `@d-zero/page-cluster`'s `onClusterReason` JSDoc for the
 * full field-by-field meaning.
 *
 * `@d-zero/page-cluster` does not publish `./build-cluster-reason` as its
 * own subpath in its `package.json` `exports` (only `./resolve-page-cluster-keys`
 * and a handful of others are public), so this type is derived structurally
 * from the one public signature that carries it — `onClusterReason`'s second
 * parameter — rather than imported directly, matching the general stance of
 * not reaching past this library's declared public surface.
 */
export type ClusterReason = Parameters<
	NonNullable<ResolvePageClusterKeysOptions['onClusterReason']>
>[1];

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
	 * archives isn't silently unresponsive.
	 */
	onProgress?: (event: ProgressEvent) => void;
}

/**
 * Result of {@link import('./classify-page-templates.js').classifyPageTemplates}.
 */
export interface ClassifyPageTemplatesResult {
	/** Page URL (`page.url.href`) → its template key. */
	templateKeysByUrl: Map<string, string>;
	/** Template key → the `ClusterReason` `@d-zero/page-cluster` reported for it. */
	clusterReasons: Map<string, ClusterReason>;
}
