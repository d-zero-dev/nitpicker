/**
 * @module @nitpicker/query/categories
 *
 * Browser-safe sub-export. Re-exports only the Content-Type category
 * symbols that have ZERO runtime dependencies — no `knex`, no
 * `@nitpicker/crawler`. The viewer's Vite bundle imports from this path
 * instead of the main `@nitpicker/query` entry, which would otherwise drag
 * the entire Node-only query runtime into the browser bundle.
 *
 * Keep this list minimal — anything that needs the SQL backends belongs in
 * the main entry, not here.
 */

export { CONTENT_TYPE_CATEGORIES, classifyContentType } from './classify-content-type.js';
export type { ContentTypeCategory, ContentTypeCount } from './types.js';
