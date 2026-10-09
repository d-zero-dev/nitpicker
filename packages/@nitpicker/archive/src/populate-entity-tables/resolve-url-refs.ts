import type { UrlRefIdMap } from './types.js';
import type { Knex } from 'knex';

/**
 * Rows sent per `SELECT ... WHERE url IN (?, ...)` chunk. SQLite's default
 * `SQLITE_MAX_VARIABLE_NUMBER` is 32766 on modern builds — 800 URLs per
 * chunk stays well under that while amortising the round-trip cost across
 * many rows.
 */
const LOOKUP_CHUNK_SIZE = 800;

/**
 * Batch-resolves `url_refs.id` for a set of URL strings (issue #193).
 *
 * Called by every entity populate helper that needs to translate a
 * legacy URL string column into a `url_id` FK. Rather than open a
 * separate SELECT per row (which multiplies migration wall-clock by
 * chunk size × URL column count) the resolver collects the distinct
 * strings the caller cares about, splits them into chunks of
 * {@link LOOKUP_CHUNK_SIZE}, issues one `WHERE url IN (?, ...)` per
 * chunk, and returns a single map.
 *
 * Missing entries fall out of the map — callers distinguish "URL is a
 * large data URI routed to blob_refs" from "URL is absent from the
 * dictionary" via a separate {@link ./resolve-blob-refs.ts} probe.
 *
 * Duplicates in `urls` are deduped internally so an image whose `src`
 * and `currentSrc` are the same value only counts once against
 * `LOOKUP_CHUNK_SIZE`.
 * @param trx - Knex instance or transaction connected to the archive DB.
 * @param urls - Iterable of URL strings to resolve. Empty and null-like
 *   values are ignored.
 * @returns Map keyed by the raw URL string; missing entries indicate
 *   the URL is not present in `url_refs`.
 * @example
 * const idMap = await resolveUrlRefs(trx, [
 *   'https://example.com/a',
 *   'https://example.com/b',
 * ]);
 * const id = idMap.get('https://example.com/a'); // number | undefined
 */
export async function resolveUrlRefs(
	trx: Knex,
	urls: Iterable<string>,
): Promise<UrlRefIdMap> {
	const distinct = new Set<string>();
	for (const url of urls) {
		if (typeof url === 'string' && url !== '') {
			distinct.add(url);
		}
	}
	if (distinct.size === 0) {
		return new Map();
	}
	const values = [...distinct];
	const result = new Map<string, number>();
	for (let index = 0; index < values.length; index += LOOKUP_CHUNK_SIZE) {
		const chunk = values.slice(index, index + LOOKUP_CHUNK_SIZE);
		const rows: { id: number; url: string }[] = await trx('url_refs')
			.select('id', 'url')
			.whereIn('url', chunk);
		for (const row of rows) {
			result.set(row.url, row.id);
		}
	}
	return result;
}
