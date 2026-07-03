/**
 * Sentinel `status_sort_key` value substituted for `null` status (errored /
 * not-yet-classified rows, or destinations never fetched). Chosen smaller
 * than any real HTTP status code (100-599) so unknown-status rows keep
 * sorting first in ascending order — matching the legacy write-model
 * queries' prior behavior of ordering directly on the nullable `status`
 * column, where SQLite treats `NULL` as smaller than any value.
 *
 * Deliberately distinct from `-1`, which `Database.resetFailedPages` already
 * uses as the "hard failure" HTTP status sentinel (see that function's docs)
 * — reusing `-1` here would conflate two different populations of rows in
 * `status_sort_key` ordering and in any future `status = -1` equality filter.
 *
 * Keyset cursor comparisons need a NEVER-`null` sort-key column: SQL's
 * three-valued logic makes `NULL > x` / `NULL < x` always evaluate to
 * `NULL` (never true), which would silently break tuple comparisons like
 * `(status_sort_key, url_sort_key, page_id) > (?, ?, ?)` for rows whose
 * status is unknown. Substituting a sentinel keeps every row on this column
 * strictly orderable.
 *
 * Shared by `viewer_pages` (`build-viewer-read-model.ts`) and
 * `viewer_anchor_facts` (`compute-anchor-fact-rows.ts`) so the same
 * status-ordering convention holds across both keyset-paginated read
 * models.
 */
export const NULL_STATUS_SENTINEL = -32_768;
