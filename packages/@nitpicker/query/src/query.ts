/**
 * @module @nitpicker/query
 *
 * Archive lifecycle management and query functions for .nitpicker files.
 * Provides SQL-level filtering and aggregation for performance with
 * large datasets (10,000+ pages, 500,000+ records).
 */

export { ArchiveManager } from './archive-manager.js';
export type { OpenResult } from './archive-manager.js';
export { checkHeaders } from './check-headers.js';
export { classifyErrorKind } from '@nitpicker/crawler';
export { computeIsolatedClusters } from './compute-isolated-clusters.js';
export { classifyContentType, CONTENT_TYPE_CATEGORIES } from './classify-content-type.js';
export { CONTENT_TYPE_RULES } from './content-type-rules.js';
export type { ContentTypeRule, MimeMatcher } from './content-type-rules.js';
export { countPagesByJsonLdType } from './count-pages-by-jsonld-type.js';
export { countPagesByTag } from './count-pages-by-tag.js';
export { findDuplicates } from './find-duplicates.js';
export { findMismatches } from './find-mismatches.js';
export { getErrorKinds } from './get-error-kinds.js';
export { getLinkGraph } from './get-link-graph.js';
export { getPageDetail } from './get-page-detail.js';
export { getPageHtml } from './get-page-html.js';
export { getPageJsonLd } from './get-page-jsonld.js';
export { getPageJsonLdOverview } from './get-page-jsonld-overview.js';
export { getPageTags } from './get-page-tags.js';
export { getResourceReferrers } from './get-resource-referrers.js';
export { getSummary } from './get-summary.js';
export { getTagInventory } from './get-tag-inventory.js';
export { getIsolatedCluster } from './get-isolated-cluster.js';
export { getViolations } from './get-violations.js';
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
export { prepareUrlSortTempTable } from './url-sort-temp-table.js';
export * from './types.js';
