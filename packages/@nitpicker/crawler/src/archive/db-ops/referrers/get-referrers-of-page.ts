import type { Knex } from 'knex';

/**
 * Retrieves pages that link to a specific page (incoming links / referrers).
 *
 * Incoming links are resolved **through redirects**: an anchor pointing at a
 * redirect source (e.g. `http://x` that 301s to `https://x`) counts as a
 * referrer of the redirect's final destination, not of the source. This keeps
 * backlinks merged on the canonical page instead of splitting them across the
 * `http`/`https` (or any redirect source/dest) pair. The resolution mirrors
 * `redirectTable()` — `redirectDestId` is pre-flattened to the final
 * destination, so `COALESCE(target.redirectDestId, target.id)` is a single hop.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId - The database ID of the target page.
 * @returns An array of referrer records with URL, hash, and text content.
 */
export async function getReferrersOfPage(knex: Knex, pageId: number) {
	const res = await knex
		.select(
			'referrer.url',
			// `through` / `throughId` = the URL the anchor actually pointed at (the
			// redirect source, e.g. `http://x`), mirroring `getPagesWithRels`'
			// `redirect.from` / `redirect.fromId`. Lets report code print the
			// "[REDIRECTED FROM]" note even on this (non-preloaded) referrer path.
			'target.url as through',
			'target.id as throughId',
			'anchors.hash',
			'anchors.textContent',
		)
		.from('anchors')
		.join('pages as referrer', 'anchors.pageId', '=', 'referrer.id')
		.join('pages as target', 'anchors.hrefId', '=', 'target.id')
		.whereRaw('coalesce("target"."redirectDestId", "target"."id") = ?', [pageId]);
	return res;
}
