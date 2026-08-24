import type { Knex } from 'knex';

/**
 * Loads text for a set of `text_refs` ids, resolved only after a keyset
 * window (or any other id-bounded read) has already limited the row count —
 * the same deferred-resolution shape every anchor-text consumer
 * (`listInboundLinks`, `listViewerBrokenLinks`, `query/report-export`)
 * shares, extracted here to stop it being copy-pasted per caller.
 * @param knex - The archive's Knex instance.
 * @param textIds - `text_refs` ids to resolve. `null` entries (no text) and
 *   duplicates are filtered out before the query.
 * @returns A map from `text_refs.id` to text.
 */
export async function resolveTextRefs(
	knex: Knex,
	textIds: readonly (number | null)[],
): Promise<Map<number, string>> {
	const ids = [...new Set(textIds.filter((id): id is number => id != null))];
	if (ids.length === 0) {
		return new Map();
	}
	const rows: { id: number; text: string }[] = await knex('text_refs')
		.whereIn('id', ids)
		.select('id', 'text');
	return new Map(rows.map((row) => [row.id, row.text]));
}
