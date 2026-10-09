import type { Knex } from 'knex';

/**
 * Retrieves pages that link to a specific page (incoming links / referrers).
 *
 * Incoming links are resolved **through redirects**: an anchor pointing at a
 * redirect source (e.g. `http://x` that 301s to `https://x`) counts as a
 * referrer of the redirect's final destination, not of the source. This keeps
 * backlinks merged on the canonical page instead of splitting them across the
 * `http`/`https` (or any redirect source/dest) pair. The resolution mirrors
 * `getPagesWithRels`' redirect handling — `redirect_dest_id` is
 * pre-flattened to the final destination, so
 * `COALESCE(target.redirect_dest_id, target.id)` is a single hop.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId - The database ID of the target page.
 * @returns An array of referrer records with URL, hash, and text content.
 */
export async function getReferrersOfPage(knex: Knex, pageId: number) {
	const res = await knex
		.select(
			'referrer_url.url as url',
			// `through` / `throughId` = the URL the anchor actually pointed at (the
			// redirect source, e.g. `http://x`), mirroring `getPagesWithRels`'
			// `redirect.from` / `redirect.fromId`. Lets report code print the
			// "[REDIRECTED FROM]" note even on this (non-preloaded) referrer path.
			'target_url.url as through',
			'target.id as throughId',
			'anchor_edges.first_hash as hash',
			'first_text.text as textContent',
		)
		.from('anchor_edges')
		.join('content_items as referrer', 'anchor_edges.page_id', '=', 'referrer.id')
		.join('url_refs as referrer_url', 'referrer.url_id', '=', 'referrer_url.id')
		.join('content_items as target', 'anchor_edges.href_page_id', '=', 'target.id')
		.join('url_refs as target_url', 'target.url_id', '=', 'target_url.id')
		.leftJoin(
			'text_refs as first_text',
			'anchor_edges.first_text_id',
			'=',
			'first_text.id',
		)
		.whereRaw('coalesce("target"."redirect_dest_id", "target"."id") = ?', [pageId]);
	return res;
}
