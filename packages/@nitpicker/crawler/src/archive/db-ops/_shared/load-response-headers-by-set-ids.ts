import type { Knex } from 'knex';

/**
 * Ids per `WHERE header_set_id IN (?, ...)` chunk. Modern SQLite builds
 * (including the vendored libsql) reject statements binding more than
 * 32,766 parameters, and header sets dedupe poorly on real sites (Date /
 * ETag / Set-Cookie make most sets unique), so an IN-list sized by the
 * page batch without chunking would exceed the limit on large archives.
 * 800 matches
 * the `LOOKUP_CHUNK_SIZE` convention the populate/upsert paths already
 * use (`resolve-text-refs.ts` and siblings).
 */
const LOOKUP_CHUNK_SIZE = 800;

/**
 * Loads and merges the response headers for every given `header_sets.id`
 * back into flat `Record<name, value>` objects, in one chunked batch
 * (never one query per row).
 *
 * Multi-value headers (repeated `Set-Cookie` etc.) are joined with
 * `', '` in `occurrence` order within each name — the flat-record shape
 * the pre-0.13 `responseHeaders` JSON column stored, which every reader
 * of the reconstructed rows still expects.
 * @param knex - Knex query builder connected to the archive DB.
 * @param headerSetIds - Distinct `header_sets.id` values to load. Empty
 *   input returns an empty map without touching the DB.
 * @returns Map from `header_sets.id` to the merged header record. Ids
 *   with no entries are absent from the map.
 * @example
 * const headersBySetId = await loadResponseHeadersBySetIds(knex, [1, 2]);
 * const record = headersBySetId.get(1) ?? {};
 */
export async function loadResponseHeadersBySetIds(
	knex: Knex,
	headerSetIds: readonly number[],
): Promise<Map<number, Record<string, string>>> {
	const merged = new Map<number, Map<string, string[]>>();
	for (let index = 0; index < headerSetIds.length; index += LOOKUP_CHUNK_SIZE) {
		const chunk = headerSetIds.slice(index, index + LOOKUP_CHUNK_SIZE);
		const headerRows = (await knex('header_set_entries as hse')
			.join('header_name_refs as hnr', 'hnr.id', 'hse.name_id')
			.join('header_value_refs as hvr', 'hvr.id', 'hse.value_id')
			.whereIn('hse.header_set_id', chunk)
			.orderBy(['hse.header_set_id', 'hnr.name', 'hse.occurrence'])
			.select(
				'hse.header_set_id as headerSetId',
				'hnr.name as name',
				'hvr.value as value',
			)) as { headerSetId: number; name: string; value: string }[];
		for (const row of headerRows) {
			const bySet = merged.get(row.headerSetId) ?? new Map<string, string[]>();
			const values = bySet.get(row.name) ?? [];
			values.push(row.value);
			bySet.set(row.name, values);
			merged.set(row.headerSetId, bySet);
		}
	}
	const result = new Map<number, Record<string, string>>();
	for (const [setId, bySet] of merged) {
		result.set(
			setId,
			Object.fromEntries([...bySet.entries()].map(([k, v]) => [k, v.join(', ')])),
		);
	}
	return result;
}
