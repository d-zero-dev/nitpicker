import type { HeaderSetIdMap } from './types.js';
import type { Knex } from 'knex';

import { computeContentHash } from '../populate-ref-tables/compute-content-hash.js';
import { decomposeHeaderSet } from '../populate-ref-tables/decompose-header-set.js';

/**
 * Rows sent per `SELECT ... WHERE raw_json_hash IN (?, ...)` chunk. Same
 * rationale as {@link ./resolve-url-refs.ts}: 500 rows × 1 param each is
 * well under the SQLite variable limit and gives good round-trip
 * amortisation.
 */
const LOOKUP_CHUNK_SIZE = 500;

/**
 * Batch-resolves `header_sets.id` for a set of raw `responseHeaders`
 * JSON strings (issue #193).
 *
 * The lookup is a two-stage cascade:
 *
 * 1. **Primary lookup** by `header_sets.raw_json_hash` — SHA-256 of the
 *    raw JSON string exactly as stored on the source row. This hits when
 *    the row's JSON key ordering matches whichever ordering populated
 *    `header_sets` first for that stable-set equivalence class (see
 *    {@link ../populate-ref-tables/populate-header-tables.ts}).
 * 2. **Fallback lookup** by `header_sets.raw_hash` for the misses — SHA-
 *    256 of the sorted `name=value` pairs. `populate-header-tables.ts`
 *    stores exactly one `raw_json_hash` per `raw_hash` equivalence class
 *    (the first JSON variant encountered), so a second variant with
 *    identical decoded content but different key ordering never had its
 *    `raw_json_hash` persisted — but its `raw_hash` still points at the
 *    shared `header_sets` row. Without the fallback these rows would
 *    silently get `header_set_id = NULL` on `content_items` /
 *    `resource_items` and the count-based acceptance check would still
 *    pass; the fallback closes that gap.
 *
 * Hashes are computed in JS because SQLite has no built-in BLAKE3 /
 * SHA-256 (see {@link ../populate-ref-tables/compute-content-hash.ts} for the
 * algorithm choice). The `raw_hash` fallback re-decomposes each miss via
 * {@link ../populate-ref-tables/decompose-header-set.ts} so the canonicalisation
 * matches the one `populateHeaderTables` used at insert time.
 *
 * Empty / null values and the sentinel `'{}'` / `'null'` strings are
 * skipped — those responses were decomposed to `null` by
 * `decomposeHeaderSet` and never produced a `header_sets` row, so the
 * caller writes `header_set_id = null` for them.
 *
 * Duplicate JSON strings are deduped internally so a page and a
 * resource sharing the same raw responseHeaders JSON only contribute
 * one lookup slot.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @param rawJsonStrings - Iterable of raw responseHeaders JSON strings.
 * @returns Map keyed by the raw JSON string; missing entries indicate
 *   no matching `header_sets` row exists (parse failure or empty set).
 * @example
 * const idMap = await resolveHeaderSets(trx, [
 *   '{"content-type":"text/html"}',
 * ]);
 * const setId = idMap.get('{"content-type":"text/html"}'); // number | undefined
 */
export async function resolveHeaderSets(
	trx: Knex,
	rawJsonStrings: Iterable<string>,
): Promise<HeaderSetIdMap> {
	const distinct = new Set<string>();
	for (const raw of rawJsonStrings) {
		if (typeof raw !== 'string' || raw === '' || raw === 'null' || raw === '{}') {
			continue;
		}
		distinct.add(raw);
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
		const rows: { id: number; raw_json_hash: Uint8Array }[] = await trx('header_sets')
			.select('id', 'raw_json_hash')
			.whereIn('raw_json_hash', chunkHashes);
		for (const row of rows) {
			const hex = Buffer.from(row.raw_json_hash).toString('hex');
			const value = hashHexToValue.get(hex);
			if (value !== undefined) {
				result.set(value, row.id);
			}
		}
	}

	// Fallback pass: any value we could not resolve by `raw_json_hash`
	// might still map to an existing `header_sets` row via `raw_hash`
	// (identical decoded content, different JSON key ordering).
	const misses = values.filter((value) => !result.has(value));
	if (misses.length === 0) {
		return result;
	}
	const rawHashByValue = new Map<string, Buffer>();
	const rawHashHexToValue = new Map<string, string>();
	for (const value of misses) {
		const decomposed = decomposeHeaderSet(value);
		if (decomposed === null) {
			continue;
		}
		rawHashByValue.set(value, decomposed.rawHash);
		rawHashHexToValue.set(decomposed.rawHash.toString('hex'), value);
	}
	const rawHashes = [...rawHashByValue.values()];
	for (let index = 0; index < rawHashes.length; index += LOOKUP_CHUNK_SIZE) {
		const chunkHashes = rawHashes.slice(index, index + LOOKUP_CHUNK_SIZE);
		const rows: { id: number; raw_hash: Uint8Array }[] = await trx('header_sets')
			.select('id', 'raw_hash')
			.whereIn('raw_hash', chunkHashes);
		for (const row of rows) {
			const hex = Buffer.from(row.raw_hash).toString('hex');
			const value = rawHashHexToValue.get(hex);
			if (value !== undefined) {
				result.set(value, row.id);
			}
		}
	}
	return result;
}
