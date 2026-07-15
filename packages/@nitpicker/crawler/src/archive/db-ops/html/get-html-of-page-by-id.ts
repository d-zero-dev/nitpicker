import type { Knex } from 'knex';

import { decodeStoredBlob } from '../../decode-html-blob.js';

/**
 * Reads the HTML snapshot stored as a zstd-compressed BLOB for the given page.
 *
 * Joins `page_html_ref` → `page_html_blobs` and decompresses inline. Returns
 * `null` when the page has no stored body (a non-HTML resource, a redirect
 * source, a degraded render). Read works identically on read-only / stub
 * connections — the special-cased "do we have a loose dir vs zip?" branching
 * the previous file-backed layout required is gone.
 *
 * Tables `page_html_ref` and `page_html_blobs` are created by `initSchema`.
 * Older `.nitpicker` archives that predate this migration must be passed
 * through `scripts/migrate-to-0.10.mjs` before they can be read.
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId - The database ID of the page.
 * @returns The decompressed HTML string, or `null` if no snapshot is stored.
 */
export async function getHtmlOfPageById(
	knex: Knex,
	pageId: number,
): Promise<string | null> {
	const row = await knex
		.from<{ body: Uint8Array; codec: string }>('page_html_ref')
		.join('page_html_blobs', 'page_html_ref.hash', '=', 'page_html_blobs.hash')
		.select('page_html_blobs.body as body', 'page_html_blobs.codec as codec')
		.where('page_html_ref.page_id', pageId)
		.first();
	if (!row) {
		return null;
	}
	return decodeStoredBlob(row.body, row.codec);
}
