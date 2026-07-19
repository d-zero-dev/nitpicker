import type { BlobRefIdMap } from './types.js';
import type { Knex } from 'knex';

import { computeContentHash } from '../populate-ref-tables/compute-content-hash.js';
import { DATA_URI_URL_REFS_LIMIT } from '../populate-ref-tables/data-uri-url-refs-limit.js';
import { decodeDataUri } from '../populate-ref-tables/decode-data-uri.js';

/**
 * Rows sent per `SELECT ... WHERE hash IN (?, ...)` chunk. `blob_refs`
 * cardinality is tiny in the reference archive (≈ 429 rows) so 200 per
 * chunk covers most realistic uses in a single query.
 */
const LOOKUP_CHUNK_SIZE = 200;

/**
 * Batch-resolves `blob_refs.id` for a set of large data-URI values
 * (issue #193).
 *
 * The routing rule matches {@link ../populate-ref-tables/populate-blob-refs.ts}:
 * only `data:` URIs longer than {@link DATA_URI_URL_REFS_LIMIT} bytes
 * land in `blob_refs`; smaller data URIs (and every regular URL) live
 * in `url_refs` instead. Callers pass URL-column values verbatim; this
 * function filters out anything that does not match the routing rule
 * before hashing.
 *
 * Malformed data URIs that fail {@link ../populate-ref-tables/decode-data-uri.ts}
 * are skipped silently — `populateBlobRefs` also skipped them (with a
 * warning), so no matching row exists to resolve.
 *
 * Duplicate values in `values` are deduped internally so an image whose
 * `src` and `currentSrc` share the same data URI only counts once.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @param values - Iterable of raw URL-column values that may or may not
 *   be large data URIs.
 * @returns Map keyed by the raw URI string; missing entries indicate
 *   the value is not stored in `blob_refs` (either not a data URI at
 *   all, below the size threshold, malformed, or absent from the
 *   dictionary).
 * @example
 * const idMap = await resolveBlobRefs(trx, [longDataUri, 'https://…']);
 * const blobId = idMap.get(longDataUri); // number | undefined
 */
export async function resolveBlobRefs(
	trx: Knex,
	values: Iterable<string>,
): Promise<BlobRefIdMap> {
	const distinct = new Set<string>();
	for (const value of values) {
		if (typeof value !== 'string' || value === '') {
			continue;
		}
		if (value.length <= DATA_URI_URL_REFS_LIMIT || !value.startsWith('data:')) {
			continue;
		}
		distinct.add(value);
	}
	if (distinct.size === 0) {
		return new Map();
	}
	const rawValues = [...distinct];
	const hashByValue = new Map<string, Buffer>();
	// `hashHexToValues` maps `hex(hash) → [raw URI strings that decoded to
	// those bytes]`. Two distinct raw data-URI strings can decode to the
	// same payload bytes (e.g. `data:image/png;base64,XXXX…` and
	// `data:image/svg+xml;base64,XXXX…` when the underlying base64 is
	// identical). `populateBlobRefs` dedups them into one row keyed by the
	// payload hash, so both raw URIs must resolve to that shared id — a
	// last-wins Map keyed by hash would drop the earlier variant, and
	// downstream `image_items` writes would lose the blob reference.
	const hashHexToValues = new Map<string, string[]>();
	for (const value of rawValues) {
		const decoded = decodeDataUri(value);
		if (decoded === null) {
			continue;
		}
		const hash = computeContentHash(decoded.bytes);
		hashByValue.set(value, hash);
		const hex = hash.toString('hex');
		const bucket = hashHexToValues.get(hex);
		if (bucket === undefined) {
			hashHexToValues.set(hex, [value]);
		} else {
			bucket.push(value);
		}
	}
	if (hashByValue.size === 0) {
		return new Map();
	}
	const hashes = [...hashByValue.values()];
	const result = new Map<string, number>();
	for (let index = 0; index < hashes.length; index += LOOKUP_CHUNK_SIZE) {
		const chunkHashes = hashes.slice(index, index + LOOKUP_CHUNK_SIZE);
		const rows: { id: number; hash: Uint8Array }[] = await trx('blob_refs')
			.select('id', 'hash')
			.whereIn('hash', chunkHashes);
		for (const row of rows) {
			const hex = Buffer.from(row.hash).toString('hex');
			const values = hashHexToValues.get(hex);
			if (values !== undefined) {
				for (const value of values) {
					result.set(value, row.id);
				}
			}
		}
	}
	return result;
}
