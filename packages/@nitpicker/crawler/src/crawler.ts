/**
 * @module @nitpicker/crawler
 *
 * Core module of Nitpicker that provides the main crawling engine,
 * utility functions, type definitions, and archive storage layer.
 */

// Types + Utils (旧 @nitpicker/types + utils)
export * from './utils/types/types.js';
export { eachSplitted } from './utils/array/each-splitted.js';
export { DOMEvaluationError } from './utils/error/dom-evaluation-error.js';
export * from './utils/object/clean-object.js';
export { globalLog as log } from './utils/debug.js';

// Archive
export { ArchiveAccessor } from './archive/archive-accessor.js';
export type { StaticPageData } from './archive/page.js';
export { default as Page } from './archive/page.js';
export { default as ArchiveResource } from './archive/resource.js';
export * from './archive/types.js';
export { default as Archive } from './archive/archive.js';
export { isArchiveCacheDisabled } from './archive/cache/is-archive-cache-disabled.js';
export { getArchiveCacheRoot } from './archive/cache/get-archive-cache-root.js';
export { computeArchiveCacheKey } from './archive/cache/compute-archive-cache-key.js';
export { resolveArchiveCacheDir } from './archive/cache/resolve-archive-cache-dir.js';
export { listArchiveCacheEntries } from './archive/cache/list-archive-cache-entries.js';
export { clearArchiveCacheRoot } from './archive/cache/clear-archive-cache-root.js';
export { clearArchiveCacheEntry } from './archive/cache/clear-archive-cache-entry.js';
export type { ArchiveCacheEntry, ArchiveCacheEntryKind } from './archive/cache/types.js';
export { copyFileWithProgress } from './archive/filesystem/copy-file-with-progress.js';
export { acquireArchiveLock, ArchiveLockError } from './archive/archive-lock.js';
export { peekArchiveLockHolder } from './archive/peek-archive-lock.js';
export type { ArchiveLockHolder } from './archive/peek-archive-lock.js';
export type {
	FlatPageMetaColumns,
	JsonLdRow,
	JsonLdRowForInsert,
	TagRow,
	TagRowForInsert,
	JsonLdSummary,
	PageDenormalizedColumns,
	TechnologySignalRow,
	TechnologySignalRowForInsert,
	PageTechnologyRow,
	PageTechnologyRowForInsert,
} from './archive/meta/types.js';
export { IncompatibleArchiveError } from './archive/meta/types.js';
export { REQUIRED_FORMAT_VERSION } from './archive/meta/assert-compatible-version.js';
export { computeBodyHash } from './archive/body-hash/compute-body-hash.js';
export { decodeStoredBlob } from './archive/decode-html-blob.js';
export { computeTierAAliasKey } from './archive/url-alias/compute-tier-a-alias-key.js';
export { computeTierBAliasKey } from './archive/url-alias/compute-tier-b-alias-key.js';
export { computeShapeKey } from './crawler/dedupe/compute-shape-key.js';

// Core
export {
	DEFAULT_EXCLUDED_EXTERNAL_URLS,
	CrawlerOrchestrator,
} from './crawler-orchestrator.js';
export * from './types.js';
export * from './crawler/types.js';
export { classifyErrorKind } from './classify-error-kind.js';
export { NETWORK_RELATED_ERROR_KINDS } from './network-related-error-kinds.js';
export type { OutageWindow } from './is-within-outage-window.js';
export { isWithinOutageWindow } from './is-within-outage-window.js';
export { default as NetworkOutageDetector } from './crawler/network-outage-detector.js';
export { default as NetworkGate } from './crawler/network-gate.js';
export type { NetworkProbe } from './crawler/probe-network.js';
export { probeNetwork } from './crawler/probe-network.js';
export { computeOutageClampTimestamp } from './archive/db-ops/outages/compute-outage-clamp-timestamp.js';
export { chooseProbeHost } from './crawler/choose-probe-host.js';
export { assertChromeIsInstalled } from './crawler/assert-chrome-installed.js';
export { assertPuppeteerSharedWithBeholder } from './crawler/assert-puppeteer-shared-with-beholder.js';
export { computeFileSha256 } from './utils/compute-file-sha256.js';
export { scanJsResourceForLicenseComment } from './crawler/scan-js-resource-for-license-comment.js';
export type {
	ScanJsResourcesForTechnologySignalsOptions,
	ScanJsResourcesForTechnologySignalsResult,
} from './crawler/scan-js-resources-for-technology-signals.js';
export { scanJsResourcesForTechnologySignals } from './crawler/scan-js-resources-for-technology-signals.js';

// 0.13 ref-table population (issue #191, epic #103). Exposed as the
// public seam that the migration script (`scripts/migrate-to-0.13.mjs`)
// drives against an already-connected archive.
// The individual sub-steps are also exported so the migration script can
// resume mid-way if the caller decides to split the transaction.
export { populateEntityTables } from './archive/populate-entity-tables/populate-entities.js';
export type { PageDomPathResolver } from './archive/populate-entity-tables/populate-image-items.js';
export { populateRefTables } from './archive/populate-ref-tables/populate-refs.js';
export { populateContentTypeRefs } from './archive/populate-ref-tables/populate-content-type-refs.js';
export { populateUrlRefs } from './archive/populate-ref-tables/populate-url-refs.js';
export { populateTextRefs } from './archive/populate-ref-tables/populate-text-refs.js';
export { populateJsonRefs } from './archive/populate-ref-tables/populate-json-refs.js';
export { populateBlobRefs } from './archive/populate-ref-tables/populate-blob-refs.js';
export { populateHeaderTables } from './archive/populate-ref-tables/populate-header-tables.js';

// 0.13 read-side reconstruction primitives. Exported so downstream
// readers (`@nitpicker/query`'s page-detail view) reconstruct
// `responseHeaders` / json_refs payloads with the exact same merge and
// decode semantics as the crawler's own read paths — one implementation,
// no cross-package drift.
export { loadResponseHeadersBySetIds } from './archive/db-ops/_shared/load-response-headers-by-set-ids.js';
export { decodeJsonRef } from './archive/db-ops/_shared/decode-json-ref.js';
export type {
	TemplateClusterBlockingEvidence,
	TemplateClusterBlockingReason,
	TemplateClusterLandmarkProfile,
	TemplateClusterLandmarkType,
	TemplateClusterReason,
} from './archive/db-ops/analysis/types.js';
