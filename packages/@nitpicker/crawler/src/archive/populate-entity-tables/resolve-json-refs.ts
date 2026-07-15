import type { Knex } from 'knex';

import { computeContentHash } from '../populate-ref-tables/compute-content-hash.js';

/**
 * Rows sent per `SELECT ... WHERE hash IN (?, ...)` chunk. `json_refs`
 * cardinality is bounded by the count of distinct `pages.meta_extras`
 * JSON strings — typically low thousands on a reference archive — so
 * 500 per chunk keeps round-trips low without straining the SQLite
 * variable limit.
 */
const LOOKUP_CHUNK_SIZE = 500;

/**
 * Batch-resolves `json_refs.id` for a set of raw `meta_extras` JSON
 * strings (issue #193).
 *
 * The lookup goes through `json_refs.hash`, the SHA-256 hash of the raw
 * JSON string stored by `populateJsonRefs` (see
 * {@link ../populate-ref-tables/populate-json-refs.ts}). Hashes are computed in JS
 * for the same reason as {@link ./resolve-header-sets.ts}: SQLite has no
 * built-in hash function.
 *
 * Empty / null strings are skipped — those pages had no `meta_extras`
 * and never produced a `json_refs` row, so the caller writes
 * `meta_extras_json_id = null` for them.
 *
 * Duplicate strings in `rawJsonStrings` are deduped internally.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @param rawJsonStrings - Iterable of raw `meta_extras` JSON strings.
 * @returns Map keyed by the raw JSON string; missing entries indicate
 *   no matching `json_refs` row exists.
 * @example
 * const idMap = await resolveJsonRefs(trx, ['{"customField":"x"}']);
 * const jsonId = idMap.get('{"customField":"x"}'); // number | undefined
 */
export async function resolveJsonRefs(
	trx: Knex,
	rawJsonStrings: Iterable<string>,
): Promise<ReadonlyMap<string, number>> {
	const distinct = new Set<string>();
	for (const raw of rawJsonStrings) {
		if (typeof raw === 'string' && raw !== '') {
			distinct.add(raw);
		}
	}
	if (distinct.size === 0) {
		return new Map();
	}
	const values = [...distinct];
	const hashByValue = new Map<string, Buffer>();
	const hashHexToValue = new Map<string, string>();
	for (const value of values) {
		const hash = computeContentHash(value);
		hashByValue.set(value, hash);
		hashHexToValue.set(hash.toString('hex'), value);
	}
	const hashes = [...hashByValue.values()];
	const result = new Map<string, number>();
	for (let index = 0; index < hashes.length; index += LOOKUP_CHUNK_SIZE) {
		const chunkHashes = hashes.slice(index, index + LOOKUP_CHUNK_SIZE);
		const rows: { id: number; hash: Uint8Array }[] = await trx('json_refs')
			.select('id', 'hash')
			.whereIn('hash', chunkHashes);
		for (const row of rows) {
			const hex = Buffer.from(row.hash).toString('hex');
			const value = hashHexToValue.get(hex);
			if (value !== undefined) {
				result.set(value, row.id);
			}
		}
	}
	return result;
}
