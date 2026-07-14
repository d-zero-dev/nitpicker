import { zstdDecompressSync } from 'node:zlib';

/**
 * Decodes a stored HTML body BLOB according to its codec marker. The codec
 * column on `page_html_blobs` records which encoding was applied at write
 * time so individual rows can be migrated to a different compression without
 * a table-wide rewrite.
 *
 * Shared by {@link ./database.ts#Database.getHtmlOfPageById} (writer read
 * path) and {@link ./populate-entity-tables/populate-image-items.ts} (0.13
 * migration, which reads HTML *inside* its writer transaction and therefore
 * cannot go through `Database.getHtmlOfPageById` — that method uses the
 * non-transactional Knex instance, and re-entering the pool from within an
 * outer writer trx serialises on libsql's single writer connection).
 * @param body - Raw bytes as stored in `page_html_blobs.body`.
 * @param codec - The `codec` column value (e.g. `'zstd'`, `'none'`).
 * @returns The decoded HTML string.
 * @throws {Error} If the codec is not recognised.
 */
export function decodeStoredBlob(body: Uint8Array, codec: string): string {
	// `Buffer.from(buffer)` accepts Uint8Array, Buffer, and array-like
	// shapes uniformly; libsql may hand back any of these for a BLOB
	// column depending on the row encoding.
	const buffer = Buffer.from(body);
	if (codec === 'zstd') {
		return zstdDecompressSync(buffer).toString('utf8');
	}
	if (codec === 'none') {
		return buffer.toString('utf8');
	}
	throw new Error(`Unknown page_html_blobs.codec: ${codec}`);
}
