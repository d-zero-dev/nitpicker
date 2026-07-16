import type { DB_Resource } from '../../types.js';
import type { Knex } from 'knex';

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
 * rows, batching the `header_set_entries` lookup across every distinct
 * `headerSetId` in the batch (one query, not N+1). Mirrors
 * {@link ../pages/read/reconstruct-page-rows.js}'s header reconstruction.
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
	const headersBySetId = new Map<number, Record<string, string>>();
	if (headerSetIds.length > 0) {
		const headerRows = (await knex('header_set_entries as hse')
			.join('header_name_refs as hnr', 'hnr.id', 'hse.name_id')
			.join('header_value_refs as hvr', 'hvr.id', 'hse.value_id')
			.whereIn('hse.header_set_id', headerSetIds)
			.orderBy(['hse.header_set_id', 'hnr.name', 'hse.occurrence'])
			.select(
				'hse.header_set_id as headerSetId',
				'hnr.name as name',
				'hvr.value as value',
			)) as { headerSetId: number; name: string; value: string }[];
		const merged = new Map<number, Map<string, string[]>>();
		for (const row of headerRows) {
			const bySet = merged.get(row.headerSetId) ?? new Map<string, string[]>();
			const values = bySet.get(row.name) ?? [];
			values.push(row.value);
			bySet.set(row.name, values);
			merged.set(row.headerSetId, bySet);
		}
		for (const [setId, bySet] of merged) {
			headersBySetId.set(
				setId,
				Object.fromEntries([...bySet.entries()].map(([k, v]) => [k, v.join(', ')])),
			);
		}
	}

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
