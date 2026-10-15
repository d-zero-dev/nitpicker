import type { ArchiveAccessor } from '@nitpicker/archive/archive-accessor';
import type { Knex } from 'knex';

import { sortArchiveUrls } from './sort-archive-urls.js';

/**
 * Options for {@link prepareUrlSortTempTable}.
 */
export interface PrepareUrlSortTempTableOptions {
	/**
	 * Forwarded to {@link sortArchiveUrls} — see
	 * {@link import('./sort-archive-urls.js').SortArchiveUrlsOptions.onProgress}.
	 */
	onProgress?: (message: string) => void;
}

/**
 * Shared table name for the connection-local URL sort cache.
 *
 * It stays exported so query builders can compose rank expressions without
 * duplicating the SQL identifier.
 * @example
 * await knex.schema.raw(`CREATE TEMP TABLE IF NOT EXISTS ${URL_SORT_TEMP_TABLE} (...)`);
 */
export const URL_SORT_TEMP_TABLE = 'viewer_url_sort_keys';

/** Rows per `INSERT` batch while handing out the ranked URLs. */
const INSERT_CHUNK_SIZE = 500;
const preparedConnections = new WeakSet<Knex>();
const pendingPreparations = new WeakMap<Knex, Promise<void>>();

/**
 * Builds the connection-local URL natural-sort TEMP table used by viewer list
 * queries. The table is intentionally temporary: archive files and crawl stubs
 * are never mutated with viewer-only sort metadata.
 *
 * Ranking is done by {@link sortArchiveUrls}: every distinct URL across
 * `pages` and `resources` is ranked in one native call, so each URL is parsed
 * once and the ranks are a dense, gap-free sequence in a total order.
 *
 * Inserts use `onConflict('url').ignore()` rather than a plain `insert` as a
 * fail-safe, not the primary dedup mechanism: {@link sortArchiveUrls} already
 * emits each distinct URL string once (a URL present in both tables is
 * de-duplicated before ranking), so a conflict is not expected. The ignore
 * only keeps a surprise (for instance two strings the database treats as one
 * key) from turning into a hard `UNIQUE` constraint crash; {@link
 * orderByUrlRank} only needs rank to be monotonic, not contiguous.
 * @param accessor - The opened archive accessor.
 * @param options - See {@link PrepareUrlSortTempTableOptions}.
 * @example
 * await prepareUrlSortTempTable(accessor);
 * const firstPage = await listPages(accessor, { sortBy: 'url' });
 */
export async function prepareUrlSortTempTable(
	accessor: ArchiveAccessor,
	options: PrepareUrlSortTempTableOptions = {},
): Promise<void> {
	const knex = accessor.getKnex();
	await knex.schema.raw(
		`CREATE TEMP TABLE IF NOT EXISTS ${URL_SORT_TEMP_TABLE} (url TEXT PRIMARY KEY, rank INTEGER NOT NULL)`,
	);
	await knex(URL_SORT_TEMP_TABLE).delete();

	let batch: { url: string; rank: number }[] = [];
	const insertRow = async (url: string, rank: number): Promise<void> => {
		batch.push({ url, rank });
		if (batch.length >= INSERT_CHUNK_SIZE) {
			await knex(URL_SORT_TEMP_TABLE).insert(batch).onConflict('url').ignore();
			batch = [];
		}
	};

	await sortArchiveUrls(accessor, insertRow, { onProgress: options.onProgress });
	if (batch.length > 0) {
		await knex(URL_SORT_TEMP_TABLE).insert(batch).onConflict('url').ignore();
	}

	preparedConnections.add(knex);
}

/**
 * Lazily prepares URL ranks for callers that enter query APIs without going
 * through the viewer startup path, such as MCP and isolated unit tests.
 * @param accessor - The opened archive accessor.
 * @param onProgress - Forwarded to {@link prepareUrlSortTempTable} — see
 *   {@link PrepareUrlSortTempTableOptions.onProgress}. Not called at all
 *   when a TEMP table already exists on this connection (the common case
 *   — nothing to report).
 * @example
 * await ensureUrlSortTempTable(accessor);
 * await listResources(accessor, { sortBy: 'url' });
 */
export async function ensureUrlSortTempTable(
	accessor: ArchiveAccessor,
	onProgress?: (message: string) => void,
): Promise<void> {
	const knex = accessor.getKnex();
	if (preparedConnections.has(knex)) return;
	// Two first requests can arrive before either has finished (the viewer's
	// list routes call this lazily): they share one preparation, so the second
	// does not `DELETE` the table the first is still filling and listing from.
	let pending = pendingPreparations.get(knex);
	if (!pending) {
		pending = prepareUrlSortTempTable(accessor, { onProgress }).finally(() => {
			pendingPreparations.delete(knex);
		});
		pendingPreparations.set(knex, pending);
	}
	await pending;
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
