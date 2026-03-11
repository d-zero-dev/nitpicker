/**
 * @module @nitpicker/query
 *
 * Archive lifecycle management and query functions for .nitpicker files.
 * Provides SQL-level filtering and aggregation for performance with
 * large datasets (10,000+ pages, 500,000+ records).
 */

export { ArchiveManager } from './archive-manager.js';
export { checkHeaders } from './check-headers.js';
export { findDuplicates } from './find-duplicates.js';
export { findMismatches } from './find-mismatches.js';
export { getPageDetail } from './get-page-detail.js';
export { getPageHtml } from './get-page-html.js';
export { getResourceReferrers } from './get-resource-referrers.js';
export { getSummary } from './get-summary.js';
export { getViolations } from './get-violations.js';
export { listImages } from './list-images.js';
export { listLinks } from './list-links.js';
export { listPages } from './list-pages.js';
export { listResources } from './list-resources.js';
export * from './types.js';
