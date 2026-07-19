import type { DB_Resource } from '../../types.js';
import type { Knex } from 'knex';

import { loadResponseHeadersBySetIds } from '../_shared/load-response-headers-by-set-ids.js';

/**
 * Raw row shape produced by {@link ../resources/build-resource-query.js}
 * before `responseHeaders` reconstruction.
 */
interface RawResourceRow extends Omit<DB_Resource, 'responseHeaders'> {
	/** `resource_items.header_set_id`, or null when no headers were recorded. */
	headerSetId: number | null;
}

/**
 * Reconstructs `responseHeaders` (JSON string) for a batch of raw resource
 * rows. Headers load through
 * {@link ../_shared/load-response-headers-by-set-ids.js} (chunked batch
 * lookup, never N+1) — the same reconstruction the page read path uses,
 * so pages and resources always agree on how a given `header_set_id`
 * reads back.
 * @param knex - Knex query builder connected to the archive DB.
 * @param rows - Raw rows from {@link ../resources/build-resource-query.js}.
 * @returns Fully reconstructed `DB_Resource` rows, in the same order as `rows`.
 * @example
 * const raw = await buildResourceQuery(knex).whereIn('ur.url', urls);
 * const resources = await reconstructResourceRows(knex, raw);
 */
export async function reconstructResourceRows(
	knex: Knex,
	rows: readonly RawResourceRow[],
): Promise<DB_Resource[]> {
	const headerSetIds = [
		...new Set(rows.map((r) => r.headerSetId).filter((id) => id != null)),
	];
	const headersBySetId = await loadResponseHeadersBySetIds(knex, headerSetIds);

	return rows.map((row) => {
		const { headerSetId, ...rest } = row;
		return {
			...rest,
			responseHeaders:
				headerSetId == null
					? null
					: JSON.stringify(headersBySetId.get(headerSetId) ?? {}),
		};
	});
}
