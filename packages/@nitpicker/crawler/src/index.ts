/**
 * @module @nitpicker/crawler
 *
 * Core module of Nitpicker that provides the main crawling engine,
 * utility functions, type definitions, and archive storage layer.
 */

// Types + Utils (旧 @nitpicker/types + utils)
export * from './utils/index.js';

// Archive
export { ArchiveAccessor } from './archive/archive-accessor.js';
export type { Redirect, Referrer, Anchor, StaticPageData } from './archive/page.js';
export { default as Page } from './archive/page.js';
export { default as ArchiveResource } from './archive/resource.js';
export * from './archive/types.js';
export { default as Archive } from './archive/archive.js';

// Core
export {
	DEFAULT_EXCLUDED_EXTERNAL_URLS,
	CrawlerOrchestrator,
} from './crawler-orchestrator.js';
export * from './types.js';
export * from './crawler/types.js';
