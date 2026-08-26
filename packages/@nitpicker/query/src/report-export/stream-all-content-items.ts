import type { ContentItemStreamRow } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { loadResponseHeadersBySetIds } from '@nitpicker/crawler';

import { buildRedirectFromUrlsByDestId } from './build-redirect-from-urls-by-dest-id.js';

/** `content_items` rows read per keyset chunk, by default. */
const READ_CHUNK_SIZE = 2000;

/**
 * Streams every `content_items` row — internal, external, skipped, and
 * never-fetched alike — for the Links report sheet.
 *
 * Deliberately bypasses `viewer_pages`/`listPages`: both are built on a
 * `scraped = 1 AND NOT is_skipped` filter (the "受容済みギャップ" in
 * ARCHITECTURE.md — bulk-listing skipped/never-fetched pages is
 * structurally unsupported there), but the Links sheet's whole purpose is
 * showing skip reasons and redirect chains for pages that never got a
 * `page_meta` row. Reads `content_items` directly instead, so no read
 * model dependency and no `scraped`/`is_skipped` filtering.
 *
 * Chunking is plain `content_items.id` keyset pagination — safe because
 * this is a 1:1 projection (one output row per `content_items` row), unlike
 * `computeAnchorFactRows`' compound-group chunking.
 *
 * The reverse redirect-from map is built once, up front, via
 * `buildRedirectFromUrlsByDestId` (shared with Page List) — a single full
 * scan bounded by the number of redirects in the archive, not by total page
 * count, so this stays well clear of the per-page N+1 query pattern the old
 * report used for referrers/anchors.
 * @param accessor - The archive accessor to query.
 * @param chunkSize - `content_items` rows read per chunk. Must be positive.
 * @yields One chunk's rows, in `content_items.id` order.
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * for await (const chunk of streamAllContentItems(accessor)) {
 *   for (const row of chunk) {
 *     sheet.appendRow(toLinksRow(row));
 *   }
 * }
 */
export async function* streamAllContentItems(
	accessor: ArchiveAccessor,
	chunkSize = READ_CHUNK_SIZE,
): AsyncGenerator<ContentItemStreamRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`streamAllContentItems: chunkSize must be positive, got ${chunkSize}`,
		);
	}
	const knex = accessor.getKnex();
	const redirectFromByDestId = await buildRedirectFromUrlsByDestId(accessor);

	let lastId = 0;
	for (;;) {
		const rows: {
			pageId: number;
			url: string;
			title: string | null;
			status: number | null;
			statusText: string | null;
			contentType: string | null;
			isSkipped: number | null;
			skipReason: string | null;
			headerSetId: number | null;
		}[] = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
			.leftJoin('page_meta as pm', 'pm.page_id', 'ci.id')
			.leftJoin('text_refs as title_ref', 'title_ref.id', 'pm.title_text_id')
			.where('ci.id', '>', lastId)
			.orderBy('ci.id', 'asc')
			.limit(chunkSize)
			.select(
				'ci.id as pageId',
				'ur.url as url',
				'title_ref.text as title',
				'ci.status as status',
				'ci.status_text as statusText',
				'ctr.raw as contentType',
				'ci.is_skipped as isSkipped',
				'ci.skip_reason as skipReason',
				'ci.header_set_id as headerSetId',
			);

		if (rows.length === 0) {
			return;
		}
		lastId = rows.at(-1)!.pageId;

		const headerSetIds = [
			...new Set(
				rows.map((row) => row.headerSetId).filter((id): id is number => id != null),
			),
		];
		const headersBySetId = await loadResponseHeadersBySetIds(knex, headerSetIds);

		yield rows.map((row) => ({
			pageId: row.pageId,
			url: row.url,
			title: row.title,
			status: row.status,
			statusText: row.statusText,
			contentType: row.contentType,
			isSkipped: !!row.isSkipped,
			skipReason: row.skipReason,
			responseHeaders:
				row.headerSetId == null ? {} : (headersBySetId.get(row.headerSetId) ?? {}),
			redirectFromUrls: redirectFromByDestId.get(row.pageId) ?? [],
		}));
	}
}
