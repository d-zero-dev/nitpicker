import type { ProgressCallback } from '../create-progress-reporter.js';
import type { Knex } from 'knex';

import { createProgressReporter } from '../create-progress-reporter.js';

import { DATA_URI_URL_REFS_LIMIT } from './data-uri-url-refs-limit.js';
import { decomposeUrl } from './decompose-url.js';

/**
 * Rows inserted per `INSERT INTO url_refs ... VALUES (...)` statement. Kept
 * well under SQLite's `SQLITE_MAX_VARIABLE_NUMBER` (default 32766 on
 * modern builds) — each row binds 7 parameters (url + scheme + host +
 * port + path + query_hash + fragment), so 500 rows = 3500 params.
 */
const INSERT_CHUNK_SIZE = 500;

/**
 * Rows scanned per keyset-paginated `SELECT` chunk. One SELECT reads all
 * URL columns for the source table's chunk simultaneously so the pages
 * table is scanned exactly once per populate call, not N-times-once-
 * per-URL-column — a per-column scan would multiply migration wall-clock
 * by the count of URL-shaped columns.
 */
const READ_CHUNK_SIZE = 5000;

/**
 * Source table + its URL-shaped columns. Each column is scanned in
 * lock-step per row, then filtered through
 * {@link routeDataUriAwayFromUrlRefs} so large data URIs skip `url_refs`
 * and route to `blob_refs` instead (handled by
 * {@link ./populate-blob-refs.ts}).
 *
 * The filter is applied to EVERY URL column (not just image columns):
 * `og:image`, `icon_href`, `apple-touch-icon`, `twitter:image`, and even
 * `og:url` / `canonical` can legally hold data URIs in the wild, and a
 * >512-byte data URI in any of those must land in `blob_refs`, not
 * pollute the URL dictionary.
 */
const URL_SOURCES: readonly {
	table: 'pages' | 'resources' | 'images';
	columns: readonly string[];
}[] = [
	{
		table: 'pages',
		columns: [
			'url',
			'canonical',
			'og_url',
			'og_image',
			'icon_href',
			'appleTouchIcon_href',
			'amphtml',
			'manifest',
			'twitter_image',
		],
	},
	{ table: 'resources', columns: ['url'] },
	{ table: 'images', columns: ['src', 'currentSrc'] },
];

/**
 * Predicate applied to every URL column value: keep the value in the
 * `url_refs` stream unless it is a data URI larger than
 * {@link DATA_URI_URL_REFS_LIMIT}. Large data URIs route to `blob_refs`
 * instead (via {@link ./populate-blob-refs.ts}).
 * @param value - Raw column value (non-null, non-empty by contract).
 * @returns `true` if the value belongs in `url_refs`.
 */
function routeDataUriAwayFromUrlRefs(value: string): boolean {
	if (!value.startsWith('data:')) {
		return true;
	}
	return value.length <= DATA_URI_URL_REFS_LIMIT;
}

/**
 * Populates `url_refs` from every URL-shaped column across `pages`,
 * `resources`, and `images` (issue #191).
 *
 * Runs two passes per source table:
 *
 * 1. **Collect distinct URLs** into an in-process `Set<string>`, streaming
 *    rows from each source table by keyset pagination on `id`. All the
 *    table's URL columns are read in a single SELECT so the pages scan
 *    is O(rows), not O(rows × columns). Peak memory is bounded by the
 *    count of distinct URLs, not the row count.
 * 2. **Bulk-insert** into `url_refs` in chunks of {@link INSERT_CHUNK_SIZE},
 *    with the decomposed columns (`scheme` / `host` / `port` / `path` /
 *    `query_hash` / `fragment`) derived in JS by {@link decomposeUrl}.
 *
 * `INSERT OR IGNORE` on `url_refs.url` makes the step idempotent —
 * repeated invocations after partial failure only add new URLs.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @param onProgress - Optional sink for periodic progress lines (one per
 *   ~5% of each source table scanned); see {@link ../create-progress-reporter.ts}.
 * @example
 * await knex.transaction(async (trx) => {
 *   await populateUrlRefs(trx);
 * });
 */
export async function populateUrlRefs(
	trx: Knex,
	onProgress?: ProgressCallback,
): Promise<void> {
	const seen = new Set<string>();

	for (const source of URL_SOURCES) {
		const hasTable = await trx.schema.hasTable(source.table);
		if (!hasTable) {
			continue;
		}
		const presentColumns: string[] = [];
		for (const column of source.columns) {
			if (await trx.schema.hasColumn(source.table, column)) {
				presentColumns.push(column);
			}
		}
		if (presentColumns.length === 0) {
			continue;
		}

		const countRows = await trx(source.table).count({ n: '*' });
		const total = Number(countRows[0]?.n ?? 0);
		const report = createProgressReporter(
			`url_refs (${source.table})`,
			total,
			onProgress,
		);
		let processed = 0;
		let cursor = 0;
		while (true) {
			const rows: Record<string, unknown>[] = await trx(source.table)
				.select('id', ...presentColumns)
				.where('id', '>', cursor)
				.orderBy('id', 'asc')
				.limit(READ_CHUNK_SIZE);
			if (rows.length === 0) {
				break;
			}
			cursor = rows.at(-1)!.id as number;
			processed += rows.length;
			report(processed);
			for (const row of rows) {
				for (const column of presentColumns) {
					const value = row[column];
					if (typeof value !== 'string' || value === '') {
						continue;
					}
					if (!routeDataUriAwayFromUrlRefs(value)) {
						continue;
					}
					seen.add(value);
				}
			}
		}
	}

	if (seen.size === 0) {
		return;
	}

	const inserts: {
		url: string;
		scheme: string | null;
		host: string | null;
		port: number | null;
		path: string | null;
		query_hash: Buffer | null;
		fragment: string | null;
	}[] = [];
	for (const url of seen) {
		const decomposed = decomposeUrl(url);
		inserts.push({ url, ...decomposed });
	}

	for (let index = 0; index < inserts.length; index += INSERT_CHUNK_SIZE) {
		const chunk = inserts.slice(index, index + INSERT_CHUNK_SIZE);
		await trx('url_refs').insert(chunk).onConflict('url').ignore();
	}
}
