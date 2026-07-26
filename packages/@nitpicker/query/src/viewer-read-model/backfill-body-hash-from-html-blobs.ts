import type { ArchiveAccessor } from '@nitpicker/crawler';

import { computeBodyHash, decodeStoredBlob } from '@nitpicker/crawler';

const CHUNK_SIZE = 500;

/**
 * Backfills `page_meta.body_hash` for pages that already have a stored HTML
 * snapshot (`page_html_blobs` via `page_html_ref`) but predate this feature,
 * so `body_hash` is still `NULL`.
 *
 * Runs only during explicit viewer-read-model builds (`viewer-build`, or the
 * automatic build at crawl completion), never on read-only open — the same
 * placement as `backfillAnalysisViolationsFromJson`. Pages crawled after this
 * feature shipped already have `body_hash` set at write time
 * (`update-page.ts`), so in practice this only has work to do on archives
 * crawled before it existed.
 *
 * Processes rows in `page_id`-ordered chunks inside their own transaction
 * (matching `migrateHtmlToBlob`'s chunking pattern) rather than one
 * archive-wide transaction, since each chunk decompresses a full HTML
 * snapshot — holding all of them in memory at once does not scale to
 * multi-hundred-thousand-page archives.
 * @param accessor - Writable archive accessor.
 * @param onProgress - Optional callback invoked after each chunk with
 *   `(processed, total)` counts, for archives large enough that visible
 *   progress matters.
 */
export async function backfillBodyHashFromHtmlBlobs(
	accessor: ArchiveAccessor,
	onProgress?: (processed: number, total: number) => void,
): Promise<void> {
	const knex = accessor.getKnex();

	const pendingQuery = () =>
		knex('page_meta as pm')
			.join('page_html_ref as phr', 'phr.page_id', 'pm.page_id')
			.whereNull('pm.body_hash');

	const [countRow] = await pendingQuery().count<{ count: string }[]>({ count: '*' });
	const total = Number(countRow?.count ?? 0);
	if (total === 0) {
		return;
	}

	let lastPageId = 0;
	let processed = 0;
	for (;;) {
		const rows = (await pendingQuery()
			.join('page_html_blobs as phb', 'phb.hash', 'phr.hash')
			.andWhere('pm.page_id', '>', lastPageId)
			.orderBy('pm.page_id')
			.limit(CHUNK_SIZE)
			.select('pm.page_id as pageId', 'phb.body as body', 'phb.codec as codec')) as {
			pageId: number;
			body: Uint8Array;
			codec: string;
		}[];
		if (rows.length === 0) {
			break;
		}

		await knex.transaction(async (trx) => {
			for (const row of rows) {
				const html = decodeStoredBlob(row.body, row.codec);
				await trx('page_meta')
					.where('page_id', row.pageId)
					.update({ body_hash: computeBodyHash(html) });
			}
		});

		lastPageId = rows.at(-1)!.pageId;
		processed += rows.length;
		onProgress?.(processed, total);
	}
}
