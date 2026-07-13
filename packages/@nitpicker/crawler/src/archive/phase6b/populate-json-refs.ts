import type { Knex } from 'knex';

import { zstdCompressSync } from 'node:zlib';

import { computeContentHash } from './compute-content-hash.js';

/**
 * Number of `json_refs` rows sent per INSERT. Each row binds 5 params
 * (hash + json_text + codec + size_raw + size_stored). 200 rows = 1000
 * params — comfortable margin under SQLite's default variable limit and
 * bounds any one INSERT's compressed-blob payload total to a size that
 * fits in one WAL frame.
 */
const INSERT_CHUNK_SIZE = 200;

/**
 * Rows scanned per source query. Same rationale as the other populators:
 * streaming with keyset pagination on `id` avoids loading a 470k-row
 * `meta_extras` column into a single result set.
 */
const READ_CHUNK_SIZE = 1000;

/**
 * Populates `json_refs` from every non-null `pages.meta_extras` value
 * (issue #191 step 6-B-3).
 *
 * Each value is:
 *
 * 1. Hashed with {@link computeContentHash} (32-byte SHA-256; see that
 *    function's docs for the plan-vs-implementation rationale).
 * 2. Compressed with `zstdCompressSync` (`codec='zstd'`) — same encoder
 *    used by `page_html_blobs`.
 * 3. Deduplicated by hash — identical raw JSON strings produce one row.
 *
 * `sizeRaw` records the uncompressed byte length (UTF-8) and `sizeStored`
 * records the compressed byte length; consumers can estimate compression
 * savings without decompressing.
 *
 * `INSERT OR IGNORE` on `hash` makes the step idempotent across partial-
 * failure restarts.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @example
 * await knex.transaction(async (trx) => {
 *   await populateJsonRefs(trx);
 * });
 */
export async function populateJsonRefs(trx: Knex): Promise<void> {
	const hasPages = await trx.schema.hasTable('pages');
	if (!hasPages) {
		return;
	}
	const hasMetaExtras = await trx.schema.hasColumn('pages', 'meta_extras');
	if (!hasMetaExtras) {
		return;
	}

	const seen = new Set<string>();
	const pending: {
		hash: Buffer;
		json_text: Buffer;
		codec: 'zstd';
		size_raw: number;
		size_stored: number;
	}[] = [];

	let cursor = 0;
	while (true) {
		const rows: { id: number; value: string | null }[] = await trx('pages')
			.select('id', 'meta_extras as value')
			.where('id', '>', cursor)
			.orderBy('id', 'asc')
			.limit(READ_CHUNK_SIZE);
		if (rows.length === 0) {
			break;
		}
		cursor = rows.at(-1)!.id;
		for (const row of rows) {
			const raw = row.value;
			if (raw == null || raw === '') {
				continue;
			}
			const rawBytes = Buffer.from(raw, 'utf8');
			const hash = computeContentHash(rawBytes);
			const hex = hash.toString('hex');
			if (seen.has(hex)) {
				continue;
			}
			seen.add(hex);
			const compressed = zstdCompressSync(rawBytes);
			pending.push({
				hash,
				json_text: compressed,
				codec: 'zstd',
				size_raw: rawBytes.byteLength,
				size_stored: compressed.byteLength,
			});
			if (pending.length >= INSERT_CHUNK_SIZE) {
				await trx('json_refs').insert(pending).onConflict('hash').ignore();
				pending.length = 0;
			}
		}
	}

	if (pending.length > 0) {
		await trx('json_refs').insert(pending).onConflict('hash').ignore();
	}
}
