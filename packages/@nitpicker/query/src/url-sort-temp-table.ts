import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { sortUrl } from '@d-zero/shared/sort-url';

/**
 * Shared table name for the connection-local URL sort cache.
 *
 * It stays exported so query builders can compose rank expressions without
 * duplicating the SQL identifier.
 * @example
 * await knex.schema.raw(`CREATE TEMP TABLE IF NOT EXISTS ${URL_SORT_TEMP_TABLE} (...)`);
 */
export const URL_SORT_TEMP_TABLE = 'viewer_url_sort_keys';

const CHUNK_SIZE = 500;
const preparedConnections = new WeakSet<Knex>();

/**
 * Builds the connection-local URL natural-sort TEMP table used by viewer list
 * queries. The table is intentionally temporary: archive files and crawl stubs
 * are never mutated with viewer-only sort metadata.
 * @param accessor - The opened archive accessor.
 * @example
 * await prepareUrlSortTempTable(accessor);
 * const firstPage = await listPages(accessor, { sortBy: 'url' });
 */
export async function prepareUrlSortTempTable(accessor: ArchiveAccessor): Promise<void> {
	const knex = accessor.getKnex();
	await knex.schema.raw(
		`CREATE TEMP TABLE IF NOT EXISTS ${URL_SORT_TEMP_TABLE} (url TEXT PRIMARY KEY, rank INTEGER NOT NULL)`,
	);
	await knex(URL_SORT_TEMP_TABLE).delete();

	const pageRows = (await knex('pages').select('url')) as { url: string }[];
	const resourceRows = (await knex('resources').select('url')) as { url: string }[];
	const urls = [...new Set([...pageRows, ...resourceRows].map((row) => row.url))];
	const ranked = buildUrlRanks(urls);

	for (let index = 0; index < ranked.length; index += CHUNK_SIZE) {
		await knex(URL_SORT_TEMP_TABLE).insert(ranked.slice(index, index + CHUNK_SIZE));
	}
	preparedConnections.add(knex);
}

/**
 * Lazily prepares URL ranks for callers that enter query APIs without going
 * through the viewer startup path, such as MCP and isolated unit tests.
 * @param accessor - The opened archive accessor.
 * @example
 * await ensureUrlSortTempTable(accessor);
 * await listResources(accessor, { sortBy: 'url' });
 */
export async function ensureUrlSortTempTable(accessor: ArchiveAccessor): Promise<void> {
	const knex = accessor.getKnex();
	if (preparedConnections.has(knex)) return;
	await prepareUrlSortTempTable(accessor);
}

/**
 * Adds an ORDER BY using the TEMP URL rank table so SQL-backed pages follow
 * the same URL order as computed in-memory views.
 * @param query - Query builder to mutate.
 * @param knex - Knex instance for raw fragments.
 * @param qualifiedUrlColumn - Qualified URL column, e.g. `"pages"."url"`.
 * @param order - Sort order.
 * @returns The query builder.
 * @example
 * orderByUrlRank(query, knex, '"pages"."url"', 'asc');
 */
export function orderByUrlRank(
	query: Knex.QueryBuilder,
	knex: Knex,
	qualifiedUrlColumn: string,
	order: 'asc' | 'desc' = 'asc',
): Knex.QueryBuilder {
	const direction = order === 'desc' ? 'desc' : 'asc';
	const rankExpression = knex.raw(
		`(select "rank" from "${URL_SORT_TEMP_TABLE}" where "${URL_SORT_TEMP_TABLE}"."url" = ${qualifiedUrlColumn})`,
	);
	return query
		.orderBy(rankExpression, direction)
		.orderByRaw(`${qualifiedUrlColumn} ${direction}`);
}

/**
 *
 * @param urls
 */
function buildUrlRanks(urls: readonly string[]): { url: string; rank: number }[] {
	const parsedByCandidate = new Map<string, string>();
	for (const parsed of sortUrl([...urls])) {
		parsedByCandidate.set(parsed.href, parsed.href);
		parsedByCandidate.set(parsed.withoutHashAndAuth, parsed.href);
	}

	const sorted = sortUrl([...urls]);
	const rankByUrl = new Map<string, number>();
	for (const [rank, parsed] of sorted.entries()) {
		const candidates = [parsed.href, parsed.withoutHashAndAuth];
		for (const candidate of candidates) {
			if (!rankByUrl.has(candidate)) {
				rankByUrl.set(candidate, rank);
			}
		}
	}

	return urls.map((url, fallbackRank) => ({
		url,
		rank:
			rankByUrl.get(url) ??
			rankByUrl.get(parsedByCandidate.get(url) ?? '') ??
			fallbackRank,
	}));
}
