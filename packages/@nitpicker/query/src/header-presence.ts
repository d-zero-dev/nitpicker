/**
 * @module @nitpicker/query/header-presence
 *
 * Lightweight subpath (mirrors `@nitpicker/query/categories`) exposing the
 * tracked security-header keys as a plain value + type, safe to import from
 * the viewer's browser bundle without pulling in the main barrel's
 * `@nitpicker/crawler`-backed surface.
 */
export { HEADER_PRESENCE_KEYS } from './header-presence-sql.js';
export type { HeaderPresence } from './types.js';
