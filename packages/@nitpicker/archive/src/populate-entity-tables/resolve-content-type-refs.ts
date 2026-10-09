import type { ContentTypeRefIdMap } from './types.js';
import type { Knex } from 'knex';

/**
 * Loads the entire `content_type_refs` dictionary into an in-process map
 * keyed by the raw wire value (issue #193).
 *
 * Content-type cardinality is small in practice — the reference archive
 * carries ≈ 400 distinct raw values across `pages` + `resources`, so
 * loading everything into a `Map` costs ≈ 40 KB and eliminates every
 * per-chunk round-trip. This is the same trade-off {@link
 * ../populate-ref-tables/populate-header-tables.ts} makes for `header_name_refs`.
 *
 * Callers should invoke this once at the start of a 0.13 populate
 * step (e.g. `populateContentItems`, `populateResourceItems`) and reuse
 * the map for every chunk.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @returns Map keyed by `content_type_refs.raw`.
 * @example
 * const contentTypeIds = await loadContentTypeRefs(trx);
 * const id = contentTypeIds.get('text/html; charset=utf-8'); // number | undefined
 */
export async function loadContentTypeRefs(trx: Knex): Promise<ContentTypeRefIdMap> {
	const rows: { id: number; raw: string }[] = await trx('content_type_refs').select(
		'id',
		'raw',
	);
	const map = new Map<string, number>();
	for (const row of rows) {
		map.set(row.raw, row.id);
	}
	return map;
}
