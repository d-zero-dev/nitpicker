import type { PageJsonLdEntry } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Retrieves all JSON-LD / SpeculationRules entries for the page at the given
 * URL.
 *
 * Default `slim = true`: returns each entry's `kind`, `type`, `rawByteSize`,
 * and `parseError` but **omits** `raw` and `parsed`. Designed so MCP / LLM
 * consumers can inspect the structure (and decide whether to drill in)
 * without exploding their token budget — an e-commerce product page can
 * have 50 schemas × 50KB each, well past sane response sizes.
 *
 * Set `slim = false` to receive the full `raw` JSON text and the `parsed`
 * object on every entry. CLI users typically pipe this into `jq` for further
 * filtering.
 *
 * Entries are returned in insertion order (matches the scraper's traversal),
 * so cross-referencing with `getPageJsonLdOverview` indexes is deterministic.
 * @param accessor - The archive accessor to query.
 * @param url - The page URL.
 * @param slim - Omit `raw` / `parsed` (default `true`).
 * @returns Ordered entries, or `[]` when the page has no JSON-LD.
 */
export async function getPageJsonLd(
	accessor: ArchiveAccessor,
	url: string,
	slim: boolean = true,
): Promise<PageJsonLdEntry[]> {
	const knex = accessor.getKnex();
	const [page] = await knex('content_items as ci')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.select('ci.id as id')
		.where('ur.url', url)
		.limit(1);
	if (!page) return [];
	const rows = await accessor.getJsonLdOfPage(page.id);
	if (slim) {
		return rows.map((r) => ({
			kind: r.kind,
			type: r.type,
			rawByteSize: Buffer.byteLength(r.raw, 'utf8'),
			parseError: r.parseError,
		}));
	}
	return rows.map((r) => ({
		kind: r.kind,
		type: r.type,
		rawByteSize: Buffer.byteLength(r.raw, 'utf8'),
		parseError: r.parseError,
		raw: r.raw,
		parsed: r.parsed,
	}));
}
