import type { WriteRefCaches } from './types.js';
import type { Knex } from 'knex';

import { zstdCompressSync } from 'node:zlib';

import { computeContentHash } from '../../populate-ref-tables/compute-content-hash.js';
import { decodeDataUri } from '../../populate-ref-tables/decode-data-uri.js';

/**
 * Resolves the `blob_refs.id` for one large `data:` URI, decoding and
 * inserting the deduplicated (hash-keyed) payload row when it is new.
 *
 * Callers route values here per the data-URI threshold rule (`data:` URIs
 * longer than `DATA_URI_URL_REFS_LIMIT` — everything else belongs in
 * `url_refs`). The payload bytes are decoded from the base64 /
 * percent-encoded tail, hashed, and stored zstd-compressed — the same
 * storage contract as the rows produced when migrating an existing
 * archive (`populate-ref-tables/populate-blob-refs.ts`).
 *
 * Returns `null` when the data URI fails to decode (malformed base64 /
 * truncated percent escape). A single malformed image `src` must not
 * abort the page write; the caller stores `*_blob_id = null` and the
 * information loss is limited to that one slot.
 * @param qb - Knex instance or transaction connected to the archive DB.
 * @param caches - The connection's write-side id caches; mutated in place.
 * @param dataUri - The raw `data:` URI value.
 * @returns The `blob_refs.id`, or `null` when the URI cannot be decoded.
 * @example
 * const id = await upsertBlobRef(knex, caches, 'data:image/png;base64,<payload>');
 */
export async function upsertBlobRef(
	qb: Knex | Knex.Transaction,
	caches: WriteRefCaches,
	dataUri: string,
): Promise<number | null> {
	const decoded = decodeDataUri(dataUri);
	if (decoded === null) {
		return null;
	}
	const hash = computeContentHash(decoded.bytes);
	const hex = hash.toString('hex');
	const cached = caches.blobIds.get(hex);
	if (cached !== undefined) {
		return cached;
	}
	const compressed = zstdCompressSync(decoded.bytes);
	const rows: { id: number }[] = await qb.raw(
		`INSERT INTO blob_refs (hash, body, codec, size_raw, size_stored)
		 VALUES (?, ?, 'zstd', ?, ?)
		 ON CONFLICT(hash) DO UPDATE SET hash = hash
		 RETURNING id`,
		[hash, compressed, decoded.bytes.byteLength, compressed.byteLength],
	);
	const first = rows[0];
	if (first === undefined) {
		throw new Error('upsertBlobRef: RETURNING yielded no row');
	}
	caches.blobIds.set(hex, first.id);
	return first.id;
}
