import type { TextRefIdMap } from './types.js';
import type { Knex } from 'knex';

import { computeContentHash } from '../populate-ref-tables/compute-content-hash.js';

/**
 * Rows sent per `SELECT ... WHERE hash IN (?, ...)` chunk. Same rationale
 * as {@link ./resolve-url-refs.ts}: 800 rows keeps the parameter count
 * well under the SQLite variable limit even in the worst case where every
 * hash is bound as its own parameter.
 */
const LOOKUP_CHUNK_SIZE = 800;

/**
 * Batch-resolves `text_refs.id` for a set of raw text strings (issue #193).
 *
 * The `text_refs` UNIQUE constraint is on `(hash, text)` so lookups
 * prefix-seek on `hash`. Each caller-supplied text is hashed in JS via
 * {@link ../populate-ref-tables/compute-content-hash.ts} (32-byte SHA-256, matching
 * how `populateTextRefs` inserted the rows in 0.13-2) before the
 * SQL query; providing the hash lets SQLite's index seek in O(log n)
 * without a full table scan.
 *
 * The `(hash, text)` UNIQUE composite makes the trailing text column
 * theoretically necessary to disambiguate the astronomically improbable
 * hash collision — we narrow on both by including `text` in the WHERE
 * clause, then filter the map keys by the exact text on read-back.
 *
 * Empty / null texts are ignored. Duplicate strings in `texts` are
 * deduped internally.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @param texts - Iterable of raw text strings to resolve.
 * @returns Map keyed by the raw text; missing entries indicate the text
 *   is not present in `text_refs` (which should not happen after
 *   0.13-2 completes but does happen mid-migration when a caller
 *   passes texts that were never inserted).
 * @example
 * const idMap = await resolveTextRefs(trx, ['My Page Title', 'Alt text']);
 * const titleId = idMap.get('My Page Title'); // number | undefined
 */
export async function resolveTextRefs(
	trx: Knex,
	texts: Iterable<string>,
): Promise<TextRefIdMap> {
	const distinct = new Set<string>();
	for (const text of texts) {
		if (typeof text === 'string' && text !== '') {
			distinct.add(text);
		}
	}
	if (distinct.size === 0) {
		return new Map();
	}
	const values = [...distinct];
	const hashes = values.map((text) => computeContentHash(text));
	const result = new Map<string, number>();
	for (let index = 0; index < values.length; index += LOOKUP_CHUNK_SIZE) {
		const chunkValues = values.slice(index, index + LOOKUP_CHUNK_SIZE);
		const chunkHashes = hashes.slice(index, index + LOOKUP_CHUNK_SIZE);
		const rows: { id: number; hash: Uint8Array; text: string }[] = await trx('text_refs')
			.select('id', 'hash', 'text')
			.whereIn('hash', chunkHashes)
			.whereIn('text', chunkValues);
		for (const row of rows) {
			result.set(row.text, row.id);
		}
	}
	return result;
}
