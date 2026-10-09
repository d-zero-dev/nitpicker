/**
 * The six landmark types page-cluster's `extractLandmarks` and
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
 * cluster) was formed — mirrors page-cluster's `BlockingReason`
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
 * A copy of the page-cluster engine's `ClusterReason` shape
 * (`template-classification/page-cluster/build-cluster-reason.ts`). Kept
 * independent of the engine (rather than importing its type directly)
 * because this is the persisted contract of `page_template_clusters.reason`
 * that `@nitpicker/query` and the browser-side viewer build type values
 * against: the engine is not part of archive's `exports`, and removing or
 * retyping a field in the engine's shape surfaces as a compile error at the
 * assignment in `classifyPageTemplates` instead of silently changing what
 * older archives are read as. A field the engine *adds* is not caught there
 * (structural assignability) and is persisted as-is in the JSON blob; mirror
 * it here and in `@nitpicker/query`'s `isTemplateClusterReason` when it
 * should be read back. The engine's `ClusterReason` is structurally
 * assignable to this type.
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
 * The human-facing name of one template cluster, as stored in
 * `page_template_labels`: rendered as `<section> template <letter>` (or
 * `template <letter>` when `section` is `null`), where the letter is
 * `ordinal` in A, B, …, Z, AA, AB, … form. Assigned by
 * {@link import('./assign-template-labels.js').assignTemplateLabels}.
 */
export interface TemplateLabel {
	/**
	 * The top-level URL directory every member page sits under (`events` for
	 * `/events/...`), or `null` when members span several directories or all
	 * sit at the site root — the label is then numbered site-wide.
	 */
	readonly section: string | null;
	/** 1-based position within `section`'s label sequence. */
	readonly ordinal: number;
}

/** One cluster's membership as {@link import('./assign-template-labels.js').assignTemplateLabels} sees it. */
export interface TemplateLabelClusterInput {
	/** Resolved `content_items.id` of every member page. */
	readonly pageIds: readonly number[];
	/** URL of every member page, for deriving {@link TemplateLabel.section}. */
	readonly urls: readonly string[];
}

/**
 * Params for {@link import('./assign-template-labels.js').assignTemplateLabels}.
 */
export interface AssignTemplateLabelsParams {
	/** The new classification: template key → members. */
	readonly clusters: ReadonlyMap<string, TemplateLabelClusterInput>;
	/**
	 * The previous classification's `page_templates` rows: template key →
	 * member page ids. Empty on a first run.
	 */
	readonly previousMembership: ReadonlyMap<string, readonly number[]>;
	/** The previous classification's `page_template_labels` rows. Empty on a first run. */
	readonly previousLabels: ReadonlyMap<string, TemplateLabel>;
}

/**
 * Params for {@link import('./replace-page-templates.js').replacePageTemplates}.
 */
export interface ReplacePageTemplatesParams {
	/** Page URL → template key, as produced by `classifyPageTemplates`. */
	readonly templateKeysByUrl: ReadonlyMap<string, string>;
	/**
	 * Template key → page-cluster's cluster-selection evidence for
	 * that key, as produced by `classifyPageTemplates`. Omitted entirely (not
	 * just empty) when the caller didn't request reasons.
	 */
	readonly clusterReasonsByTemplateKey?: ReadonlyMap<string, TemplateClusterReason>;
}
