/**
 * The action a `content_items` transfer plan (`temp.xfer_ci_plan`) assigns
 * to each source row, stored as a small integer so the plan table can be
 * queried/joined without a TEXT comparison.
 *
 * - `full` — insert the source row (and its page-scoped data) as a
 *   brand-new destination row. Used by both concat (no existing dest row
 *   for this URL yet) and split (in-scope, kept in full).
 * - `stub` — insert only the `content_items` row itself, forced to
 *   `is_external = 1` / `is_target = 0`; no `page_meta` or any other
 *   page-scoped row is copied. Split-only — an out-of-scope page that a
 *   kept page still references (an anchor target or a redirect
 *   destination).
 * - `replace` — an existing destination row for this URL is overwritten
 *   because this source's observation outranks it (see
 *   `content-item-rank-sql.ts`). Concat-only.
 * - `skip` — the source row is not copied at all; the destination already
 *   holds an equal-or-better observation for this URL. Concat-only.
 *
 * `full` and `stub` are the only actions {@link
 * import('./plan-content-items-for-split.js').planContentItemsForSplit}
 * ever assigns; `full`, `replace`, and `skip` are the only actions {@link
 * import('./plan-content-items-for-concat.js').planContentItemsForConcat}
 * ever assigns — a row not present in the plan at all means "dropped"
 * (split-only: out of scope and unreferenced by anything kept).
 */
export const TRANSFER_ACTION = {
	full: 1,
	stub: 2,
	replace: 3,
	skip: 4,
} as const;

/** Union of {@link TRANSFER_ACTION}'s values. */
export type TransferAction = (typeof TRANSFER_ACTION)[keyof typeof TRANSFER_ACTION];
