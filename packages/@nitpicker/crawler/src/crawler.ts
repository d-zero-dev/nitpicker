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
export { ErrorEmitter } from './utils/error/error-emitter.js';
export type { ErrorEvent } from './utils/error/error-emitter.js';
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
	TagsSummary,
	TagInventoryEntry,
	PageDenormalizedColumns,
} from './archive/meta/types.js';
export { IncompatibleArchiveError } from './archive/meta/types.js';
export { REQUIRED_FORMAT_VERSION } from './archive/meta/assert-compatible-version.js';

// Core
export {
	DEFAULT_EXCLUDED_EXTERNAL_URLS,
	CrawlerOrchestrator,
} from './crawler-orchestrator.js';
export * from './types.js';
export * from './crawler/types.js';
export { classifyErrorKind } from './classify-error-kind.js';
export { computeFileSha256 } from './utils/compute-file-sha256.js';
