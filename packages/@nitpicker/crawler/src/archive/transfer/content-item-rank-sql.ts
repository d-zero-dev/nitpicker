/**
 * SQL fragment computing a `content_items` row's "richness" rank for
 * concat's same-URL conflict resolution: `2` (scraped internal page) beats
 * `1` (scraped external HEAD-only observation) beats `0` (never scraped).
 * Concat keeps whichever source's row ranks highest for a given URL; a tie
 * is resolved by processing sources in argument order and overwriting on
 * `>=` (see {@link import('./plan-content-items-for-concat.js').planContentItemsForConcat}),
 * so the LAST source with an equal-or-better rank wins.
 *
 * This is the single definition of the ranking lattice — every other
 * ranking (or a change to it) must go through this function so concat's
 * conflict resolution cannot silently drift from what this doc describes.
 * @param alias - The table alias (or bare table name) the fragment reads
 *   `scraped`/`is_external` from, e.g. `'s'` for `xfer_src.content_items s`.
 * @returns A SQL expression (no trailing semicolon) evaluating to `0`, `1`, or `2`.
 * @example
 * ```ts
 * trx.raw(`SELECT ${contentItemRankSql('s')} as rank FROM xfer_src.content_items s`);
 * ```
 */
export function contentItemRankSql(alias: string): string {
	return `(CASE WHEN ${alias}.scraped = 1 THEN 2 - ${alias}.is_external ELSE 0 END)`;
}
