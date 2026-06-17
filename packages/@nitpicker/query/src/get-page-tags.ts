import type { PageTagEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Retrieves all Wappalyzer tag entries for the page at the given URL.
 *
 * Each entry preserves the full provider × external-id row from `page_tags`
 * (no slim mode needed — tag rows are O(KB) per entry, not O(MB) like
 * JSON-LD `raw`).
 *
 * Use `summarizeTags` (re-exported via Page wrapper) for the lightweight
 * provider → ids map; this function is the drill-down for callers that want
 * `version`, `confidence`, `categories`, and `sources` too.
 * @param accessor - The archive accessor to query.
 * @param url - The page URL.
 * @returns Ordered tag entries, or `[]` when the page has no tags.
 */
export async function getPageTags(
	accessor: ArchiveAccessor,
	url: string,
): Promise<PageTagEntry[]> {
	const knex = accessor.getKnex();
	const [page] = await knex('pages').select('id').where('url', url).limit(1);
	if (!page) return [];
	const rows = await accessor.getTagsOfPage(page.id);
	return rows.map((r) => ({
		provider: r.provider,
		category: r.category,
		externalId: r.externalId,
		version: r.version,
		confidence: r.confidence,
		categories: r.categories,
		sources: r.sources as ReadonlyArray<Record<string, unknown>>,
	}));
}
