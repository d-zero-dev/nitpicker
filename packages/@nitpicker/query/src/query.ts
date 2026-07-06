/**
 * @module @nitpicker/query
 *
 * Archive lifecycle management and query functions for .nitpicker files.
 * Provides SQL-level filtering and aggregation for performance with
 * large datasets (10,000+ pages, 500,000+ records).
 */

export { ArchiveManager } from './archive-manager.js';
export type { OpenResult } from './archive-manager.js';
export { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';
export { checkHeaders } from './check-headers.js';
export { classifyErrorKind } from '@nitpicker/crawler';
export { computeIsolatedClusters } from './compute-isolated-clusters.js';
export { classifyContentType, CONTENT_TYPE_CATEGORIES } from './classify-content-type.js';
export { CONTENT_TYPE_RULES } from './content-type-rules.js';
export type { ContentTypeRule, MimeMatcher } from './content-type-rules.js';
export { countPagesByJsonLdType } from './count-pages-by-jsonld-type.js';
export { countPagesByTag } from './count-pages-by-tag.js';
export { dropViewerReadModel } from './viewer-read-model/drop-viewer-read-model.js';
export { ensureViewerReadModel } from './viewer-read-model/ensure-viewer-read-model.js';
export { findDuplicates } from './find-duplicates.js';
export { findMismatches } from './find-mismatches.js';
export { getDirectoryTree } from './get-directory-tree.js';
export { getErrorKinds } from './get-error-kinds.js';
export { getErrorKindsFastPath } from './get-error-kinds-fast-path.js';
export { getImagesFastPath } from './get-images-fast-path.js';
export { getIsolatedCluster } from './get-isolated-cluster.js';
export { getLinkGraph } from './get-link-graph.js';
export { getPageDetail } from './get-page-detail.js';
export { getPageHtml } from './get-page-html.js';
export { getPageJsonLd } from './get-page-jsonld.js';
export { getPageJsonLdOverview } from './get-page-jsonld-overview.js';
export { getPageTags } from './get-page-tags.js';
export { getResourceReferrers } from './get-resource-referrers.js';
export { getSummary } from './get-summary.js';
export { getSummaryFastPath } from './get-summary-fast-path.js';
export { getTagInventory } from './get-tag-inventory.js';
export { getViewerErrorKinds } from './get-viewer-error-kinds.js';
export { getViewerReadModelVersion } from './viewer-read-model/get-viewer-read-model-version.js';
export { getViewerSummary } from './get-viewer-summary.js';
export { getViolations } from './get-violations.js';
export { hasViewerReadModel } from './viewer-read-model/has-viewer-read-model.js';
export { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';
export { listDirectoryChildren } from './list-directory-children.js';
export { listDirectoryPages } from './list-directory-pages.js';
export { listExternalLinks } from './list-external-links.js';
export { listImages } from './list-images.js';
export { listInventoryRuns } from './list-inventory-runs.js';
export { listIsolatedClusters } from './list-isolated-clusters.js';
export { listIsolatedPages } from './list-isolated-pages.js';
export { listLinks } from './list-links.js';
export { listPages } from './list-pages.js';
export { listPagesByJsonLdType } from './list-pages-by-jsonld-type.js';
export { listPagesByTag } from './list-pages-by-tag.js';
export { listResources } from './list-resources.js';
export { listUnusedResources } from './list-unused-resources.js';
export { listViewerBrokenLinks } from './list-viewer-broken-links.js';
export { listViewerExternalLinks } from './list-viewer-external-links.js';
export { listViewerImages } from './list-viewer-images.js';
export { listViewerPages } from './list-viewer-pages.js';
export { listViewerResources } from './list-viewer-resources.js';
export { listViewerUnusedResources } from './list-viewer-unused-resources.js';
export { prepareUrlSortTempTable } from './url-sort-temp-table.js';
export { resolveErrorKindsSort } from './resolve-error-kinds-sort.js';
export type { ResolvedErrorKindsSort } from './resolve-error-kinds-sort.js';
export { sortArrayItems } from './sort-array-items.js';
export * from './types.js';
