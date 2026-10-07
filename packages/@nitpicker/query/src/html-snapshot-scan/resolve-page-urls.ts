import type { Knex } from 'knex';

import { SQLITE_IN_CHUNK } from '../sqlite-in-chunk.js';

/**
 * Looks up the URL of each page id, in `SQLITE_IN_CHUNK` batches. The HTML
 * searches call it only for the page slice they return, not for every
 * matched page, so a broad match does not hold every URL in memory.
 * @param knex - The archive's Knex instance.
 * @param pageIds - `content_items.id` values to resolve.
 * @returns URL by page id; ids without a page are absent.
 * @example
 * const urlByPageId = await resolvePageUrls(knex, [1, 3]);
 * urlByPageId.get(1); // 'https://example.com/'
 */
export async function resolvePageUrls(
	knex: Knex,
	pageIds: readonly number[],
): Promise<Map<number, string>> {
	const urlByPageId = new Map<number, string>();
	for (let i = 0; i < pageIds.length; i += SQLITE_IN_CHUNK) {
		const rows = (await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.whereIn('ci.id', pageIds.slice(i, i + SQLITE_IN_CHUNK))
			.select('ci.id as pageId', 'ur.url as url')) as {
			pageId: number;
			url: string;
		}[];
		for (const row of rows) {
			urlByPageId.set(row.pageId, row.url);
		}
	}
	return urlByPageId;
}
