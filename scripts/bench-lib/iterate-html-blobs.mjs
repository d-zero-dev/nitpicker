/** Blobs read per keyset query; bounds the compressed bytes held at once. */
const DEFAULT_CHUNK_SIZE = 200;

/**
 * Yields every stored HTML snapshot a page still references (`page_html_blobs`
 * rows with a `page_html_ref`, one per distinct document), still
 * compressed, in hash order, reading in keyset chunks so a large archive
 * never holds more than one chunk.
 *
 * Blobs no page references are skipped: nothing deletes a blob when a
 * re-crawl replaces a page's HTML, so an archive's history of superseded
 * snapshots would otherwise inflate a per-page workload with documents the
 * production code never reads.
 *
 * Not built on `@nitpicker/query`'s `scanHtmlSnapshots`, which walks the
 * same set: it decodes every snapshot to a string inside its loop, so the
 * caller could neither take the bytes (what the native body hash is fed)
 * nor time decoding apart from the work under measurement.
 * @param {import('knex').Knex} knex - The archive's connection.
 * @param {{ chunkSize?: number }} [options] - `chunkSize`: rows per query
 *   (default 200).
 * @yields {{ body: Uint8Array; codec: string }} One stored blob.
 * @returns {AsyncGenerator<{ body: Uint8Array; codec: string }>}
 * @example
 * for await (const blob of iterateHtmlBlobs(accessor.getKnex())) {
 *   const html = decodeStoredBlob(blob.body, blob.codec);
 * }
 */
export async function* iterateHtmlBlobs(knex, options = {}) {
	const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
	let lastHash = null;
	for (;;) {
		const query = knex('page_html_blobs as phb')
			.whereExists(function () {
				this.select(knex.raw('1'))
					.from('page_html_ref as phr')
					.whereRaw('phr.hash = phb.hash');
			})
			.select('phb.hash', 'phb.body', 'phb.codec')
			.orderBy('phb.hash')
			.limit(chunkSize);
		if (lastHash !== null) {
			query.where('phb.hash', '>', lastHash);
		}
		const rows = await query;
		if (rows.length === 0) {
			return;
		}
		for (const row of rows) {
			yield { body: row.body, codec: row.codec };
		}
		lastHash = Buffer.from(rows.at(-1).hash);
	}
}
