// Archive storage and retrieval layer for Nitpicker crawl data.
//
// This package provides the `Archive` class for creating, reading, and writing
// `.nitpicker` archive files that store crawl results in a SQLite database along with
// optional HTML snapshots. It also exports the `ArchiveAccessor` for read-only
// access, `Page` and `Resource` model classes, and all related types.
export * from './archive-accessor.js';
export type { Redirect, Referrer, Anchor, StaticPageData } from './page.js';
export { default as Page } from './page.js';
export { default as Resource } from './resource.js';
export * from './types.js';

export { default } from './archive.js';
