import type { WriteRefCaches } from './types.js';
import type { Knex } from 'knex';

import { computeContentHash } from '../../populate-ref-tables/compute-content-hash.js';

import { compressPayload } from './compress-payload.js';

/**
 * Resolves the `json_refs.id` for one JSON payload string, inserting the
 * deduplicated (hash-keyed) row when the payload is new.
 *
 * The payload is hashed over its raw UTF-8 bytes and stored
 * zstd-compressed (`codec = 'zstd'`) with `size_raw` / `size_stored`
 * bookkeeping — the same storage contract as `page_html_blobs` and the
 * dictionary rows produced when migrating an existing archive
 * (`populate-ref-tables/populate-json-refs.ts`). Identical payloads
 * (e.g. the same `meta_extras` JSON across templated pages) produce one
 * row; the compression cost is paid only on a cache-and-DB miss.
 * @param qb - Knex instance or transaction connected to the archive DB.
 * @param caches - The connection's write-side id caches; mutated in place.
 * @param jsonText - Raw JSON string. Empty / null input must be
 *   short-circuited by the caller (`*_json_id = null`).
 * @returns The `json_refs.id` of the existing or new row.
 * @example
 * const id = await upsertJsonRef(knex, caches, JSON.stringify(extras));
 */
export async function upsertJsonRef(
	qb: Knex | Knex.Transaction,
	caches: WriteRefCaches,
	jsonText: string,
): Promise<number> {
	const rawBytes = Buffer.from(jsonText, 'utf8');
	const hash = computeContentHash(rawBytes);
	const hex = hash.toString('hex');
	const cached = caches.jsonIds.get(hex);
	if (cached !== undefined) {
		return cached;
	}
	const { body, sizeRaw, sizeStored } = compressPayload(rawBytes);
	const rows: { id: number }[] = await qb.raw(
		`INSERT INTO json_refs (hash, json_text, codec, size_raw, size_stored)
		 VALUES (?, ?, 'zstd', ?, ?)
		 ON CONFLICT(hash) DO UPDATE SET hash = hash
		 RETURNING id`,
		[hash, body, sizeRaw, sizeStored],
	);
	const first = rows[0];
	if (first === undefined) {
		throw new Error('upsertJsonRef: RETURNING yielded no row');
	}
	caches.jsonIds.set(hex, first.id);
	return first.id;
}
