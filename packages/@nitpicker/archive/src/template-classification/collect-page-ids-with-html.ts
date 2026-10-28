import type Archive from '../archive.js';

/**
 * Collects the ids (`Page.id`) of the pages that have a non-empty HTML
 * snapshot stored, without decompressing any of them.
 *
 * Template classification reads only pages with HTML, and its engine reads
 * the corpus several times, decompressing each page only on the reads that
 * use it. Which pages take part has to be known before the first read, the
 * same on every read: deciding it by calling `Page.getHtml()` would
 * decompress every page on every read. A snapshot is non-empty exactly when
 * its raw UTF-8 size (`page_html_blobs.size_raw`, recorded when it was
 * written) is above zero, and a page whose `page_html_ref` points at no blob
 * reads back as `null` — both match what `Page.getHtml()` returns. Keyed by
 * id, not URL, so the answer is the page's own, whatever its URL normalizes
 * to.
 * @param archive - The archive to read from.
 * @returns The ids, in no particular order.
 * @example
 * ```ts
 * const pageIdsWithHtml = await collectPageIdsWithHtml(archive);
 * const pagesWithHtml = pages.filter((page) => pageIdsWithHtml.has(page.id));
 * ```
 */
export async function collectPageIdsWithHtml(archive: Archive): Promise<Set<number>> {
	const rows = await archive
		.getKnex()('page_html_ref as ref')
		.join('page_html_blobs as blob', 'blob.hash', 'ref.hash')
		.where('blob.size_raw', '>', 0)
		.select<{ pageId: number }[]>('ref.page_id as pageId');
	return new Set(rows.map((row) => row.pageId));
}
