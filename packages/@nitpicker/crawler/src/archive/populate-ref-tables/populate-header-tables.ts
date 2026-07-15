import type { DecomposedHeaderSet } from './types.js';
import type { Knex } from 'knex';

import { computeContentHash } from './compute-content-hash.js';
import { computeHeaderFlags } from './compute-header-flags.js';
import { decomposeHeaderSet } from './decompose-header-set.js';

/**
 * Rows scanned per SELECT chunk against `pages.responseHeaders` /
 * `resources.responseHeaders`. Keyset-paginated on `id` to avoid loading
 * a 470k-row `responseHeaders` column into a single query result.
 */
const READ_CHUNK_SIZE = 500;

/**
 * Rows inserted per INSERT statement into `header_set_entries`. Each row
 * binds 5 params so 500 rows = 2500 params — safely under SQLite's
 * default variable limit.
 */
const ENTRY_INSERT_CHUNK_SIZE = 500;

/**
 * In-process caches shared across every source row processed by one call
 * to {@link populateHeaderTables}. The three id-maps let us resolve
 * `header_name_refs.id` / `header_value_refs.id` / `header_sets.id`
 * without hitting the DB once a value has been seen (or preloaded).
 *
 * `setIdsProcessedThisRun` tracks the subset of `setIdByRawJsonHash` /
 * `setIdByRawHash` that this run has already written entries + flags
 * for. A preloaded id from a prior partial run is present in the id
 * caches but NOT in this set — so we still re-run the entries + flags
 * inserts (which are safe under `INSERT OR IGNORE`) to repair the
 * missing rows. Once this run has written entries+flags for a given
 * setId, the shortcut fires and skips redundant no-op inserts.
 */
interface HeaderTableCaches {
	/** `lower-cased name → header_name_refs.id`. */
	readonly nameIdCache: Map<string, number>;
	/** `hexHash|value → header_value_refs.id`. */
	readonly valueIdCache: Map<string, number>;
	/** `hex(raw_json_hash) → header_sets.id`. */
	readonly setIdByRawJsonHash: Map<string, number>;
	/** `hex(raw_hash) → header_sets.id`. */
	readonly setIdByRawHash: Map<string, number>;
	/** `header_sets.id` values already fully processed this run. */
	readonly setIdsProcessedThisRun: Set<number>;
}

/**
 * Populates the five header decomposition tables (`header_name_refs`,
 * `header_value_refs`, `header_sets`, `header_set_entries`,
 * `header_flags`) from every `pages.responseHeaders` and
 * `resources.responseHeaders` JSON blob (issue #191).
 *
 * Strategy:
 *
 * 1. **Warm caches** — load existing `header_name_refs`,
 *    `header_value_refs`, and `header_sets` rows into id maps. Idempotent
 *    re-runs then reuse ids instead of re-issuing an upsert per entry,
 *    and new ids are appended as they are inserted.
 * 2. **Stream `pages.responseHeaders` + `resources.responseHeaders`** in
 *    id-keyset chunks. Each non-null value is decomposed via
 *    {@link decomposeHeaderSet}.
 * 3. **Reuse setIds by identity**: two responseHeaders JSON strings with
 *    different key ordering but identical sorted entries hash to the
 *    same `raw_hash`; we look up by `raw_hash` first so this variant
 *    reuses the existing `header_sets.id` without triggering the
 *    `UNIQUE(raw_hash)` conflict. Same for `raw_json_hash`.
 * 4. **Insert entries + flags** exactly once per setId per run — a
 *    setId preloaded from the DB (e.g. by a prior crashed run) still
 *    runs the entries/flags path (guarded by `INSERT OR IGNORE`) so
 *    partial state is repaired.
 *
 * Every write is bulk-batched so the migration stays O(chunks × per-
 * chunk-distinct-decomposed-sets) round-trips against the DB. Idempotency
 * across full re-runs is guaranteed by the `INSERT OR IGNORE`s and the
 * `setIdsProcessedThisRun` guard.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @example
 * await knex.transaction(async (trx) => {
 *   await populateHeaderTables(trx);
 * });
 */
export async function populateHeaderTables(trx: Knex): Promise<void> {
	const caches: HeaderTableCaches = {
		nameIdCache: await loadNameIdCache(trx),
		valueIdCache: await loadValueIdCache(trx),
		setIdByRawJsonHash: new Map<string, number>(),
		setIdByRawHash: new Map<string, number>(),
		setIdsProcessedThisRun: new Set<number>(),
	};
	await preloadSetIdCaches(trx, caches);

	for (const table of ['pages', 'resources'] as const) {
		const hasTable = await trx.schema.hasTable(table);
		if (!hasTable) {
			continue;
		}
		const hasColumn = await trx.schema.hasColumn(table, 'responseHeaders');
		if (!hasColumn) {
			continue;
		}
		await processSourceTable(trx, table, caches);
	}
}

/**
 * Loads every row of `header_name_refs` into `name → id`. Called once at
 * the start of {@link populateHeaderTables} so subsequent lookups skip the DB.
 * @param trx - Knex instance.
 * @returns Map keyed by lower-cased header name.
 */
async function loadNameIdCache(trx: Knex): Promise<Map<string, number>> {
	const cache = new Map<string, number>();
	const rows: { id: number; name: string }[] = await trx('header_name_refs').select();
	for (const row of rows) {
		cache.set(row.name, row.id);
	}
	return cache;
}

/**
 * Loads every row of `header_value_refs` into `hexHash|value → id`.
 * Values are keyed by both hash and value so an identical string with a
 * hash collision (astronomically improbable) is still disambiguated.
 * @param trx - Knex instance.
 * @returns Map keyed by `hexHash|value`.
 */
async function loadValueIdCache(trx: Knex): Promise<Map<string, number>> {
	const cache = new Map<string, number>();
	const rows: { id: number; hash: Uint8Array; value: string }[] =
		await trx('header_value_refs').select();
	for (const row of rows) {
		cache.set(valueKey(Buffer.from(row.hash), row.value), row.id);
	}
	return cache;
}

/**
 * Loads every row of `header_sets` into `hex(raw_json_hash) → id` and
 * `hex(raw_hash) → id`. Both are UNIQUE per the 0.13 DDL so each
 * is a total function.
 * @param trx - Knex instance.
 * @param caches - The cache bundle to seed.
 */
async function preloadSetIdCaches(trx: Knex, caches: HeaderTableCaches): Promise<void> {
	const rows: { id: number; raw_json_hash: Uint8Array; raw_hash: Uint8Array }[] =
		await trx('header_sets').select('id', 'raw_json_hash', 'raw_hash');
	for (const row of rows) {
		caches.setIdByRawJsonHash.set(Buffer.from(row.raw_json_hash).toString('hex'), row.id);
		caches.setIdByRawHash.set(Buffer.from(row.raw_hash).toString('hex'), row.id);
	}
}

/**
 * Streams every row of one source table (`pages` or `resources`) and
 * populates the header tables for each decomposed non-null header set.
 * @param trx - Knex instance.
 * @param table - Source table.
 * @param caches - The in-process caches, mutated in place.
 */
async function processSourceTable(
	trx: Knex,
	table: 'pages' | 'resources',
	caches: HeaderTableCaches,
): Promise<void> {
	let cursor = 0;
	while (true) {
		const rows: { id: number; responseHeaders: string | null }[] = await trx(table)
			.select('id', 'responseHeaders')
			.where('id', '>', cursor)
			.orderBy('id', 'asc')
			.limit(READ_CHUNK_SIZE);
		if (rows.length === 0) {
			break;
		}
		cursor = rows.at(-1)!.id;
		for (const row of rows) {
			const decomposed = decomposeHeaderSet(row.responseHeaders);
			if (decomposed === null) {
				continue;
			}
			await upsertOneHeaderSet(trx, decomposed, caches);
		}
	}
}

/**
 * Upserts one decomposed header set and its entries + flags.
 *
 * Set-id resolution order:
 *
 * 1. `raw_json_hash` cache — same JSON key ordering as a previous row.
 * 2. `raw_hash` cache — same sorted-entries identity, different JSON key
 *    ordering. This branch links the new `raw_json_hash` to the existing
 *    setId in the in-process map so subsequent same-JSON hits fast-path.
 * 3. Otherwise INSERT a new `header_sets` row.
 *
 * Entries + flags are inserted once per `setId` per run (guarded by
 * `setIdsProcessedThisRun`); already-inserted rows short-circuit
 * cheaply, and preloaded-but-unprocessed setIds (partial prior run) get
 * their entries/flags repaired via `INSERT OR IGNORE`.
 * @param trx - Knex instance.
 * @param decomposed - Result of `decomposeHeaderSet`.
 * @param caches - The in-process caches, mutated in place.
 */
async function upsertOneHeaderSet(
	trx: Knex,
	decomposed: DecomposedHeaderSet,
	caches: HeaderTableCaches,
): Promise<void> {
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
			// (raw_json_hash is UNIQUE per row) — a future 0.13
			// follow-up may add a raw_json_hash → setId mapping table so
			// 0.13 can find both variants.
			caches.setIdByRawJsonHash.set(rawJsonHashHex, setId);
		}
	}

	if (caches.setIdsProcessedThisRun.has(setId)) {
		return;
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
			'populateHeaderTables: header_sets INSERT returned no rows despite absent conflict',
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
		await trx('header_name_refs')
			.insert([...missing].map((name) => ({ name })))
			.onConflict('name')
			.ignore();
		const inserted: { id: number; name: string }[] = await trx('header_name_refs')
			.select('id', 'name')
			.whereIn('name', [...missing]);
		for (const row of inserted) {
			cache.set(row.name, row.id);
		}
	}
	return entries.map((entry) => {
		const id = cache.get(entry.name);
		if (id === undefined) {
			throw new Error(`populateHeaderTables: name_id not resolved for ${entry.name}`);
		}
		return id;
	});
}

/**
 * Resolves the `value_id` for every entry in `entries`, inserting new
 * values into `header_value_refs` as needed. Values are hashed once and
 * deduped by `(hash, value)` per the 0.13 UNIQUE constraint.
 *
 * The read-back after INSERT uses `.whereIn('hash')` + `.whereIn('value')`
 * to constrain the round-trip result set to exactly the values we just
 * wrote (a Buffer[] hash-only IN would return the correct rows in
 * theory but leans on a driver detail — narrowing on `value` too
 * defends against any BLOB-parameter round-trip quirk in libsql).
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
		const key = valueKey(hash, entry.value);
		if (!cache.has(key) && !missingKeys.has(key)) {
			missing.push({ key, hash, value: entry.value });
			missingKeys.add(key);
		}
	}
	if (missing.length > 0) {
		await trx('header_value_refs')
			.insert(missing.map(({ hash, value }) => ({ hash, value })))
			.onConflict(['hash', 'value'])
			.ignore();
		const inserted: { id: number; hash: Uint8Array; value: string }[] = await trx(
			'header_value_refs',
		)
			.select('id', 'hash', 'value')
			.whereIn(
				'value',
				missing.map((m) => m.value),
			);
		for (const row of inserted) {
			cache.set(valueKey(Buffer.from(row.hash), row.value), row.id);
		}
	}
	return entries.map((entry, i) => {
		const key = valueKey(hashByEntryIndex[i]!, entry.value);
		const id = cache.get(key);
		if (id === undefined) {
			throw new Error(
				`populateHeaderTables: value_id not resolved for ${entry.value.slice(0, 40)}…`,
			);
		}
		return id;
	});
}

/**
 * Composite cache key for `header_value_refs`: hex-encoded hash + a
 * separator + raw value. Two values with the same hash but different
 * strings (astronomically improbable, but a `BLOB` hash column is not
 * a total function per SQL semantics) still resolve to distinct cache
 * entries.
 * @param hash - 32-byte content hash.
 * @param value - Header value verbatim.
 * @returns Cache key string.
 */
function valueKey(hash: Buffer, value: string): string {
	return `${hash.toString('hex')}|${value}`;
}
