import type { Knex } from 'knex';

/**
 * Reads the stored HTML snapshot row of a page (`page_html_ref` →
 * `page_html_blobs`) without decoding it.
 *
 * Kept apart from the decode so that a caller can retry the read (a
 * transient database failure) without retrying the decode (a corrupt or
 * oversized blob fails the same way every time).
 * @param knex - Knex query builder connected to the archive DB.
 * @param pageId - The database ID of the page.
 * @returns The blob's hash, stored bytes and codec, or `null` if no snapshot is stored.
 */
export async function readPageHtmlBlob(
	knex: Knex,
	pageId: number,
): Promise<{ hash: Uint8Array; body: Uint8Array; codec: string } | null> {
	const row = await knex
		.from<{ hash: Uint8Array; body: Uint8Array; codec: string }>('page_html_ref')
		.join('page_html_blobs', 'page_html_ref.hash', '=', 'page_html_blobs.hash')
		.select(
			'page_html_blobs.hash as hash',
			'page_html_blobs.body as body',
			'page_html_blobs.codec as codec',
		)
		.where('page_html_ref.page_id', pageId)
		.first();
	return row ?? null;
}
