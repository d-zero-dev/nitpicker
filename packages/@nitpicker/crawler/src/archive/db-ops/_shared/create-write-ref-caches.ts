import type { WriteRefCaches } from './types.js';

/**
 * Creates an empty {@link WriteRefCaches} bundle for one archive writer
 * connection.
 *
 * All maps start empty and fill lazily as the write path touches URLs,
 * content types, JSON payloads, and data-URI blobs. The header caches
 * (`headers`) start as `null` and are warmed from the DB by the first
 * header-set upsert — see {@link ./types.ts} for the cache-correctness
 * argument (append-only ref tables + single writer connection).
 * @returns A fresh cache bundle. One per `Database` instance; never share
 *   across connections.
 * @example
 * const caches = createWriteRefCaches();
 * const urlId = await upsertUrlRef(knex, caches, 'https://example.com/');
 */
export function createWriteRefCaches(): WriteRefCaches {
	return {
		urlIds: new Map(),
		contentItems: new Map(),
		resourceIds: new Map(),
		contentTypeIds: new Map(),
		jsonIds: new Map(),
		blobIds: new Map(),
		consoleLogIds: new Map(),
		headers: null,
	};
}
