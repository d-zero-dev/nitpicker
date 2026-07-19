import type { DecomposedHeaderSet, HeaderTableCaches } from './types.js';
import type { Knex } from 'knex';

import { computeContentHash } from './compute-content-hash.js';
import { computeHeaderFlags } from './compute-header-flags.js';
import { headerValueCacheKey } from './header-value-cache-key.js';

/**
 * Rows inserted per INSERT statement into `header_set_entries`. Each row
 * binds 5 params so 500 rows = 2500 params — safely under SQLite's
 * default variable limit.
 */
const ENTRY_INSERT_CHUNK_SIZE = 500;

/**
 * Upserts one decomposed header set and its entries + flags, returning
 * the `header_sets.id`. Shared by the bulk archive populate
 * ({@link ./populate-header-tables.ts}) and the crawler's per-response
 * write path, so both produce byte-identical header rows for the same
 * raw `responseHeaders` value.
 *
 * Set-id resolution order:
 *
 * 1. `raw_json_hash` cache — same JSON key ordering as a previous row.
 * 2. `raw_hash` cache — same sorted-entries identity, different JSON key
 *    ordering. This branch links the new `raw_json_hash` to the existing
 *    setId in the in-process map so subsequent same-JSON hits fast-path.
 * 3. Otherwise INSERT a new `header_sets` row.
 *
 * Entries + flags are inserted once per `setId` per process (guarded by
 * `setIdsProcessedThisRun`); already-inserted rows short-circuit
 * cheaply, and preloaded-but-unprocessed setIds (partial prior run) get
 * their entries / flags repaired via `INSERT OR IGNORE`.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @param decomposed - Result of `decomposeHeaderSet` (never `null` — the
 *   caller short-circuits null decompositions to `header_set_id = null`).
 * @param caches - The in-process caches, mutated in place. Create via
 *   {@link ./create-header-table-caches.ts}.
 * @returns The `header_sets.id` for this set.
 * @example
 * const decomposed = decomposeHeaderSet(rawJson);
 * if (decomposed !== null) {
 *   const setId = await upsertOneHeaderSet(knex, decomposed, caches);
 * }
 */
export async function upsertOneHeaderSet(
	trx: Knex,
	decomposed: DecomposedHeaderSet,
	caches: HeaderTableCaches,
): Promise<number> {
	const rawJsonHashHex = decomposed.rawJsonHash.toString('hex');
	const rawHashHex = decomposed.rawHash.toString('hex');

	let setId = caches.setIdByRawJsonHash.get(rawJsonHashHex);
	if (setId === undefined) {
		setId = caches.setIdByRawHash.get(rawHashHex);
		if (setId === undefined) {
			setId = await insertHeaderSet(trx, decomposed);
			caches.setIdByRawJsonHash.set(rawJsonHashHex, setId);
			caches.setIdByRawHash.set(rawHashHex, setId);
		} else {
			// Same sorted-entries identity as an existing row, different JSON
			// key ordering. Reuse the existing setId; the raw_json_hash of
			// this variant has no persistent home in the 0.13 schema
			// (raw_json_hash is UNIQUE per row) — linking it in the
			// in-process map is enough for id resolution.
			caches.setIdByRawJsonHash.set(rawJsonHashHex, setId);
		}
	}

	if (caches.setIdsProcessedThisRun.has(setId)) {
		return setId;
	}

	const nameIds = await resolveNameIds(trx, decomposed.entries, caches.nameIdCache);
	const valueIds = await resolveValueIds(trx, decomposed.entries, caches.valueIdCache);

	const entryRows = decomposed.entries.map((entry, index) => ({
		header_set_id: setId,
		name_id: nameIds[index]!,
		occurrence: entry.occurrence,
		value_id: valueIds[index]!,
		is_volatile: entry.isVolatile ? 1 : 0,
	}));
	for (let index = 0; index < entryRows.length; index += ENTRY_INSERT_CHUNK_SIZE) {
		const chunk = entryRows.slice(index, index + ENTRY_INSERT_CHUNK_SIZE);
		await trx('header_set_entries')
			.insert(chunk)
			.onConflict(['header_set_id', 'name_id', 'occurrence'])
			.ignore();
	}

	const flags = computeHeaderFlags(decomposed.entries);
	await trx('header_flags')
		.insert({ header_set_id: setId, ...flags })
		.onConflict('header_set_id')
		.ignore();

	caches.setIdsProcessedThisRun.add(setId);
	return setId;
}

/**
 * Inserts a new `header_sets` row and returns its id. Neither
 * `raw_json_hash` nor `raw_hash` collided with an existing row when
 * this is called — the caller has already checked both caches.
 * @param trx - Knex instance.
 * @param decomposed - Result of `decomposeHeaderSet`.
 * @returns The newly-inserted `header_sets.id`.
 */
async function insertHeaderSet(
	trx: Knex,
	decomposed: DecomposedHeaderSet,
): Promise<number> {
	const rows: { id: number }[] = await trx('header_sets')
		.insert({
			raw_json_hash: decomposed.rawJsonHash,
			raw_hash: decomposed.rawHash,
			stable_hash: decomposed.stableHash,
			volatile_hash: decomposed.volatileHash,
			entry_count: decomposed.entryCount,
			stable_entry_count: decomposed.stableEntryCount,
		})
		.returning('id');
	const first = rows[0];
	if (first === undefined) {
		throw new Error(
			'upsertOneHeaderSet: header_sets INSERT returned no rows despite absent conflict',
		);
	}
	return first.id;
}

/**
 * Resolves the `name_id` for every entry in `entries`, inserting new
 * names into `header_name_refs` as needed. Mutates `cache` with any new
 * ids.
 * @param trx - Knex instance.
 * @param entries - Decomposed entries.
 * @param cache - Name → id cache; mutated in place.
 * @returns Parallel array of name ids (same order as `entries`).
 */
async function resolveNameIds(
	trx: Knex,
	entries: readonly { name: string }[],
	cache: Map<string, number>,
): Promise<number[]> {
	const missing = new Set<string>();
	for (const entry of entries) {
		if (!cache.has(entry.name)) {
			missing.add(entry.name);
		}
	}
	if (missing.size > 0) {
		const missingNames = [...missing];
		// Chunked like the entries insert below: knex compiles a multi-row
		// insert-with-onConflict into a compound SELECT, and SQLite rejects
		// more than 500 compound terms per statement.
		for (let index = 0; index < missingNames.length; index += ENTRY_INSERT_CHUNK_SIZE) {
			const chunk = missingNames.slice(index, index + ENTRY_INSERT_CHUNK_SIZE);
			await trx('header_name_refs')
				.insert(chunk.map((name) => ({ name })))
				.onConflict('name')
				.ignore();
			const inserted: { id: number; name: string }[] = await trx('header_name_refs')
				.select('id', 'name')
				.whereIn('name', chunk);
			for (const row of inserted) {
				cache.set(row.name, row.id);
			}
		}
	}
	return entries.map((entry) => {
		const id = cache.get(entry.name);
		if (id === undefined) {
			throw new Error(`upsertOneHeaderSet: name_id not resolved for ${entry.name}`);
		}
		return id;
	});
}

/**
 * Resolves the `value_id` for every entry in `entries`, inserting new
 * values into `header_value_refs` as needed. Values are hashed once and
 * deduped by `(hash, value)` per the 0.13 UNIQUE constraint.
 *
 * The read-back after INSERT narrows on `.whereIn('value', ...)` — the
 * string values just written — instead of binding the Buffer hashes into
 * a `WHERE hash IN (...)`: a Buffer[] IN would return the correct rows
 * in theory but leans on libsql's BLOB-parameter round-trip behaviour,
 * while string values compare reliably. The cache key still includes the
 * hash, so hash-distinct entries stay disambiguated.
 * @param trx - Knex instance.
 * @param entries - Decomposed entries.
 * @param cache - `hexHash|value → id` cache; mutated in place.
 * @returns Parallel array of value ids (same order as `entries`).
 */
async function resolveValueIds(
	trx: Knex,
	entries: readonly { value: string }[],
	cache: Map<string, number>,
): Promise<number[]> {
	const hashByEntryIndex: Buffer[] = entries.map((entry) =>
		computeContentHash(entry.value),
	);
	const missing: { key: string; hash: Buffer; value: string }[] = [];
	const missingKeys = new Set<string>();
	for (const [i, entry] of entries.entries()) {
		const hash = hashByEntryIndex[i]!;
		const key = headerValueCacheKey(hash, entry.value);
		if (!cache.has(key) && !missingKeys.has(key)) {
			missing.push({ key, hash, value: entry.value });
			missingKeys.add(key);
		}
	}
	// Chunked like the entries insert: knex compiles a multi-row
	// insert-with-onConflict into a compound SELECT, and SQLite rejects
	// more than 500 compound terms per statement.
	for (let index = 0; index < missing.length; index += ENTRY_INSERT_CHUNK_SIZE) {
		const chunk = missing.slice(index, index + ENTRY_INSERT_CHUNK_SIZE);
		await trx('header_value_refs')
			.insert(chunk.map(({ hash, value }) => ({ hash, value })))
			.onConflict(['hash', 'value'])
			.ignore();
		const inserted: { id: number; hash: Uint8Array; value: string }[] = await trx(
			'header_value_refs',
		)
			.select('id', 'hash', 'value')
			.whereIn(
				'value',
				chunk.map((m) => m.value),
			);
		for (const row of inserted) {
			cache.set(headerValueCacheKey(Buffer.from(row.hash), row.value), row.id);
		}
	}
	return entries.map((entry, i) => {
		const key = headerValueCacheKey(hashByEntryIndex[i]!, entry.value);
		const id = cache.get(key);
		if (id === undefined) {
			throw new Error(
				`upsertOneHeaderSet: value_id not resolved for ${entry.value.slice(0, 40)}…`,
			);
		}
		return id;
	});
}
