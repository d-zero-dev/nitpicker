import type { PageJsonLdOverviewEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Returns lightweight overview entries for the JSON-LD on a page: per entry,
 * the `kind`, `type`, byte size of the raw text, and parse error (if any).
 *
 * Designed as the "metadata before data" probe for MCP / LLM consumers
 * before calling {@link import('./get-page-jsonld.js').getPageJsonLd} with
 * `slim = false`. The total of `rawByteSize` tells the caller whether the
 * full payload fits in their token budget.
 *
 * SQL: `SELECT kind, type, length(raw) AS rawByteSize, parseError FROM
 * page_jsonld WHERE pageId = ?`. Importantly, `length(raw)` returns the
 * byte count without reading the body into memory.
 * @param accessor - The archive accessor to query.
 * @param url - The page URL.
 * @returns Per-entry overview, or `[]` when the page has no JSON-LD.
 */
export async function getPageJsonLdOverview(
	accessor: ArchiveAccessor,
	url: string,
): Promise<PageJsonLdOverviewEntry[]> {
	const knex = accessor.getKnex();
	const [page] = await knex('pages').select('id').where('url', url).limit(1);
	if (!page) return [];
	const rows = (await knex('page_jsonld')
		.select('kind', 'type', knex.raw('length(raw) AS rawByteSize'), 'parseError')
		.where('pageId', page.id)
		.orderBy('id', 'asc')) as Array<{
		kind: string;
		type: string | null;
		rawByteSize: number;
		parseError: string | null;
	}>;
	return rows.map((r) => ({
		kind: r.kind === 'speculationrules' ? 'speculationrules' : 'ld+json',
		type: r.type,
		rawByteSize: r.rawByteSize,
		parseError: r.parseError,
	}));
}
