import type { TextRefIdMap } from './types.js';
import type { Knex } from 'knex';

import { computeContentHash } from '../populate-ref-tables/compute-content-hash.js';

/**
 * Rows sent per `INSERT INTO text_refs ... VALUES (...)` statement. Each
 * row binds 2 params (hash + text) so 500 rows = 1 000 params — well
 * under the SQLite variable limit.
 */
const INSERT_CHUNK_SIZE = 500;

/**
 * Rows sent per `SELECT ... WHERE hash IN (?, ...)` chunk on the
 * post-insert read-back. Same reasoning as {@link ./resolve-text-refs.ts}.
 */
const LOOKUP_CHUNK_SIZE = 800;

/**
 * Upserts a set of text strings into `text_refs` and returns their ids
 * (issue #193 entity populate step 6).
 *
 * Unlike {@link ./resolve-text-refs.ts}, which only reads, this helper
 * inserts every missing string first. It exists specifically for
 * `dom_path` strings, which are synthesised during 0.13-6 and were
 * not among the 0.13-2 sources — the caller cannot rely on the
 * dictionary already containing them.
 *
 * Strategy:
 *
 * 1. **Hash and INSERT OR IGNORE** every input string in bulk. New rows
 *    materialise; conflicts are silently skipped.
 * 2. **Read back** by hash + text (the `(hash, text)` UNIQUE composite)
 *    to pick up both freshly-inserted and pre-existing ids.
 *
 * The read-back narrows on both hash and text (same defensive shape as
 * {@link ../populate-ref-tables/populate-header-tables.ts}'s `resolveValueIds`) so
 * an astronomically improbable hash collision cannot leak the wrong
 * id back to the caller.
 *
 * Empty / null strings are ignored; duplicates in `texts` are deduped
 * internally.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @param texts - Iterable of text strings to upsert.
 * @returns Map keyed by the raw text string.
 * @example
 * const idMap = await upsertTextRefs(trx, [
 *   'html/body[1]/img[1]',
 *   'unknown/42',
 * ]);
 */
export async function upsertTextRefs(
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
	const inserts = values.map((text, index) => ({ hash: hashes[index]!, text }));
	for (let index = 0; index < inserts.length; index += INSERT_CHUNK_SIZE) {
		const chunk = inserts.slice(index, index + INSERT_CHUNK_SIZE);
		await trx('text_refs').insert(chunk).onConflict(['hash', 'text']).ignore();
	}
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
