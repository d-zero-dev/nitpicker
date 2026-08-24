import type { Knex } from 'knex';

/**
 * Loads URL strings for a set of `viewer_url_refs` ids, resolved only after
 * a keyset window (or any other id-bounded read) has already limited the
 * row count — the same deferred-resolution shape every `viewer_anchor_facts`
 * consumer (`listInboundLinks`, `listViewerBrokenLinks`,
 * `query/report-export`) shares, extracted here to stop it being
 * copy-pasted per caller.
 * @param knex - The archive's Knex instance.
 * @param refIds - `viewer_url_refs` ids to resolve. Duplicates and gaps are
 *   fine; the result only contains ids that were actually requested and
 *   found.
 * @returns A map from `viewer_url_refs.id` to URL.
 */
export async function resolveViewerUrlRefs(
	knex: Knex,
	refIds: readonly number[],
): Promise<Map<number, string>> {
	if (refIds.length === 0) {
		return new Map();
	}
	const rows: { id: number; url: string }[] = await knex('viewer_url_refs')
		.whereIn('id', [...new Set(refIds)])
		.select('id', 'url');
	return new Map(rows.map((row) => [row.id, row.url]));
}
