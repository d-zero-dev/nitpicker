/**
 * SQLite's `SQLITE_MAX_VARIABLE_NUMBER` defaults to 999 on classic builds,
 * 32766 on modern ones (see `resolve-url-refs.ts`'s docs) — this archive's
 * `libsql` build is the latter, so no fixed batch size any caller in this
 * codebase currently passes is actually large enough to trigger
 * `SQLITE_ERROR: too many SQL variables` today. Chunking every `whereIn`
 * batch at this size anyway is cheap insurance: it keeps a query correct
 * at any archive size regardless of which limit actually applies (a
 * different SQLite build, or a future caller passing an
 * archive-size-proportional id set instead of a fixed batch), rather than
 * relying on today's specific combination of build and call sites to stay
 * that way.
 *
 * Not shared with `@nitpicker/crawler`'s identical constant in
 * `Database.getExistingPageUrls`: `core → query` is not a dependency edge
 * either package can take, so that copy stays independent. Within
 * `@nitpicker/query` itself, this is the one shared definition — every
 * `whereIn`-chunking call site in this package imports it from here.
 */
export const SQLITE_IN_CHUNK = 500;
