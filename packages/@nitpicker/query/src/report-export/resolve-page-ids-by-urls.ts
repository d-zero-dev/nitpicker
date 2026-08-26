import type { ArchiveAccessor } from '@nitpicker/crawler';

import { eachSplitted } from '@nitpicker/crawler';

import { SQLITE_IN_CHUNK } from '../sqlite-in-chunk.js';

/**
 * Resolves a batch of page URLs to their `content_items.id` values.
 *
 * `PageListItem` (from `listViewerPages`) deliberately does not expose the
 * internal `content_items.id` — it is a display DTO shared with the viewer
 * and MCP server, which have no use for it. The Page List report sheet
 * does need it: `getOutboundLinkFactsByPageIds`/
 * `getInboundReferrerUrlsByPageIds`/`buildRedirectFromUrlsByDestId` all key
 * their results by `content_items.id`, since that is what
 * `viewer_anchor_facts`/`content_items.redirect_dest_id` themselves use.
 * Rather than widen `PageListItem`'s public shape for this one internal
 * need, `run()` resolves ids back from the URLs in its own cursor batch via
 * this one extra query.
 * @param accessor - The archive accessor to query.
 * @param urls - Page URLs to resolve.
 * @returns Map from URL to `content_items.id`. A URL with no matching row
 *   has no entry.
 * @example
 * const ids = await resolvePageIdsByUrls(accessor, page.items.map((i) => i.url));
 * const idForItem = ids.get(item.url);
 */
export async function resolvePageIdsByUrls(
	accessor: ArchiveAccessor,
	urls: readonly string[],
): Promise<Map<string, number>> {
	if (urls.length === 0) {
		return new Map();
	}
	const knex = accessor.getKnex();
	const result = new Map<string, number>();
	await eachSplitted(urls, SQLITE_IN_CHUNK, async (chunk) => {
		const rows: { id: number; url: string }[] = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.whereIn('ur.url', chunk)
			.select('ci.id as id', 'ur.url as url');
		for (const row of rows) {
			result.set(row.url, row.id);
		}
	});
	return result;
}
