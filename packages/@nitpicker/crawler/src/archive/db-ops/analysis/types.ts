/**
 * The six landmark types `@d-zero/page-cluster`'s `extractLandmarks` and
 * `ClusterReason.landmarks` recognize.
 */
export type TemplateClusterLandmarkType =
	| 'header'
	| 'footer'
	| 'nav'
	| 'aside'
	| 'form'
	| 'search';

/**
 * Why a Pass-0 block (one of possibly several that merged into a final
 * cluster) was formed — mirrors `@d-zero/page-cluster`'s `BlockingReason`
 * discriminated union.
 */
export type TemplateClusterBlockingReason =
	| { readonly kind: 'css'; readonly distinctiveStylesheetHrefs: readonly string[] }
	| { readonly kind: 'path'; readonly pathKey: string }
	| { readonly kind: 'orphanMerge'; readonly pathKey: string };

/** One block's blocking key and the reason it was formed. */
export interface TemplateClusterBlockingEvidence {
	readonly blockKey: string;
	readonly reason: TemplateClusterBlockingReason;
}

/** How common one landmark type is across a cluster's member pages. */
export interface TemplateClusterLandmarkProfile {
	readonly presenceRate: number;
	readonly chromeRate: number;
	readonly shellTokens: readonly string[];
	readonly memberCountWithInstance: number;
}

/**
 * nitpicker's own copy of `@d-zero/page-cluster`'s `ClusterReason` shape.
 * Kept independent of the `@d-zero/page-cluster` package (rather than
 * importing its type directly) so `@nitpicker/query` — which does not
 * depend on `@d-zero/page-cluster` and is consumed by the browser-side
 * viewer build — never has to add that dependency just to type a value
 * read back out of the archive. `@d-zero/page-cluster`'s `ClusterReason`
 * is structurally assignable to this type.
 */
export interface TemplateClusterReason {
	readonly memberCount: number;
	readonly blocking: readonly TemplateClusterBlockingEvidence[];
	readonly structuralCoreTokens: readonly string[];
	readonly landmarks: Partial<
		Record<TemplateClusterLandmarkType, TemplateClusterLandmarkProfile>
	>;
	readonly siblingClusterKeys: readonly string[];
}

/**
 * Params for {@link import('./replace-page-templates.js').replacePageTemplates}.
 */
export interface ReplacePageTemplatesParams {
	/** Page URL → template key, as produced by `classifyPageTemplates`. */
	readonly templateKeysByUrl: ReadonlyMap<string, string>;
	/**
	 * Template key → `@d-zero/page-cluster`'s cluster-selection evidence for
	 * that key, as produced by `classifyPageTemplates`. Omitted entirely (not
	 * just empty) when the caller didn't request reasons.
	 */
	readonly clusterReasonsByTemplateKey?: ReadonlyMap<string, TemplateClusterReason>;
}
