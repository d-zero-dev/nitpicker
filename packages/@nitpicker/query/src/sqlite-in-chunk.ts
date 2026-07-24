/**
 * SQLite's default `SQLITE_MAX_VARIABLE_NUMBER` is 999. Chunking every
 * `whereIn` batch at this size — safely under that cap — keeps a query
 * correct at any archive size instead of throwing `SQLITE_ERROR: too many
 * SQL variables` once a filtered id set crosses 999.
 *
 * Not shared with `@nitpicker/crawler`'s identical constant in
 * `Database.getExistingPageUrls`: `core → query` is not a dependency edge
 * either package can take, so that copy stays independent. Within
 * `@nitpicker/query` itself, this is the one shared definition — every
 * `whereIn`-chunking call site in this package imports it from here.
 */
export const SQLITE_IN_CHUNK = 500;
