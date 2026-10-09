import type { WriteRefCaches } from './types.js';
import type { Knex } from 'knex';

import { DATA_URI_URL_REFS_LIMIT } from '../../populate-ref-tables/data-uri-url-refs-limit.js';

import { upsertBlobRef } from './upsert-blob-ref.js';
import { upsertUrlRef } from './upsert-url-ref.js';

/**
 * Routes one URL-shaped value to either `url_refs` or `blob_refs` per the
 * data-URI threshold rule (large data URIs live in `blob_refs`, everything
 * else in `url_refs`), upserting into whichever dictionary applies.
 *
 * Shared by every writer that can receive a `data:` URI in a URL-shaped
 * column: `image_items.src` / `current_src` and `resource_items`' own
 * identity URL. At most one of `url` / `blob` is non-null; both are `null`
 * when the value is empty or a malformed data URI that fails to decode.
 * @param qb - Knex instance or transaction connected to the archive DB.
 * @param caches - The connection's write-side id caches.
 * @param value - Raw URL-shaped value.
 * @returns `{ url, blob }` pair with at most one non-null field.
 * @example
 * const slot = await resolveUrlOrBlob(trx, caches, image.src);
 * // slot.url set for a regular URL, slot.blob set for a large data: URI.
 */
export async function resolveUrlOrBlob(
	qb: Knex | Knex.Transaction,
	caches: WriteRefCaches,
	value: string | null | undefined,
): Promise<{ url: number | null; blob: number | null }> {
	if (typeof value !== 'string' || value === '') {
		return { url: null, blob: null };
	}
	if (value.startsWith('data:') && value.length > DATA_URI_URL_REFS_LIMIT) {
		return { url: null, blob: await upsertBlobRef(qb, caches, value) };
	}
	return { url: await upsertUrlRef(qb, caches, value), blob: null };
}
