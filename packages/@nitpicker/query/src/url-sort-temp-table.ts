import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { externalSortUrls } from './external-url-sort.js';

/**
 * Options for {@link prepareUrlSortTempTable}.
 */
export interface PrepareUrlSortTempTableOptions {
	/**
	 * Forwarded to {@link externalSortUrls} — see
	 * {@link import('./external-url-sort.js').ExternalSortUrlsOptions.onProgress}.
	 * Ignored when {@link PrepareUrlSortTempTableOptions.rankedUrls} is given,
	 * since {@link externalSortUrls} does not run in that case.
	 */
	onProgress?: (message: string) => void;
	/**
	 * Skips {@link externalSortUrls} entirely and inserts from this source
	 * instead. For callers that persisted a prior external-sort run's output
	 * (e.g. `@nitpicker/viewer`'s on-disk URL-sort cache) and want to replay
	 * it without re-paying the read-chunk-sort-merge cost on every process
	 * restart.
	 */
	rankedUrls?: AsyncIterable<{ url: string; rank: number }>;
	/**
	 * Called once per ranked row as it is written to the TEMP TABLE, in
	 * addition to the insert itself. Lets a caller persist a fresh
	 * {@link externalSortUrls} run's output (e.g. to the on-disk cache
	 * `rankedUrls` later replays) without a second full pass over the
	 * archive. Not called when `rankedUrls` is given — there is nothing new
	 * to persist in that case.
	 */
	onRanked?: (url: string, rank: number) => void;
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

/** Rows per `INSERT` batch while draining the external sort's output. */
const INSERT_CHUNK_SIZE = 500;
const preparedConnections = new WeakSet<Knex>();

/**
 * Builds the connection-local URL natural-sort TEMP table used by viewer list
 * queries. The table is intentionally temporary: archive files and crawl stubs
 * are never mutated with viewer-only sort metadata.
 *
 * Ranking is done via {@link externalSortUrls} (external merge sort) rather
 * than an in-memory parse-everything-then-sort pass, so a million-plus-URL
 * archive doesn't need to hold every parsed URL in memory at once.
 *
 * Inserts use `onConflict('url').ignore()` rather than a plain `insert` as a
 * fail-safe, not the primary dedup mechanism: {@link
 * import('./merge-sorted-url-chunks.js').mergeSortedUrlChunks} already
 * drains every chunk-file cursor tied with the current winner so the same
 * URL (present in both a `pages` and a `resources` chunk) is emitted once.
 * That relies on `compareUrlSortKeys` being a consistent total order, which
 * it inherits from `@d-zero/shared`'s `numericalComparator` — a
 * common-prefix-strip natural-sort comparator that is not guaranteed
 * transitive. If it ever disagrees with itself on a huge archive, `ignore()`
 * turns what would otherwise be a hard `UNIQUE` constraint crash into a
 * silently-skipped duplicate rank. The rank sequence ends up with a gap
 * where that happens, but {@link orderByUrlRank} only needs rank to be
 * monotonic, not contiguous.
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

	if (options.rankedUrls) {
		for await (const { url, rank } of options.rankedUrls) {
			await insertRow(url, rank);
		}
	} else {
		await externalSortUrls(
			accessor,
			async (url, rank) => {
				await insertRow(url, rank);
				options.onRanked?.(url, rank);
			},
			{ onProgress: options.onProgress },
		);
	}
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
	await prepareUrlSortTempTable(accessor, { onProgress });
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
