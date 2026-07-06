import type { Knex } from 'knex';

/** Rows read per `pages` id-keyset scan chunk, by default. */
const READ_CHUNK_SIZE = 20_000;

/** One row to insert into `viewer_mismatches`, produced by `computeMismatchInsertRows`. */
export interface MismatchInsertRow {
	/** Which metadata comparison this row failed. */
	type: 'canonical' | 'og:title' | 'og:description';
	/** The write-model `pages.id` this row represents. */
	page_id: number;
	/**
	 * The page's URL, verbatim — the same "inline the sort key as text"
	 * convention `viewer_pages.url_sort_key` uses.
	 */
	url_sort_key: string;
	/**
	 * The page's actual value for this comparison — `url` for `type:
	 * 'canonical'`, `og_title`/`og_description` for the other two.
	 */
	actual: string | null;
	/**
	 * The value `actual` was expected to match — `canonical` for `type:
	 * 'canonical'`, `title`/`description` for the other two.
	 */
	expected: string | null;
}

/** One raw `pages` row read for one mismatch `type`'s chunk scan, pre-aliased to `actual`/`expected`. */
interface MismatchSourceRow {
	id: number;
	url: string;
	actual: string | null;
	expected: string | null;
}

/**
 * Builds the filtered (but not yet chunk-bounded) query for one mismatch
 * `type` — the exact WHERE predicate `findMismatches` itself uses for that
 * type (base `scraped = 1, isExternal = 0, contentType = 'text/html',
 * redirectDestId IS NULL` plus the type's own non-null/non-empty `!=`
 * comparison), with columns pre-aliased to `actual`/`expected` so
 * `computeMismatchInsertRows`'s id-keyset scan loop can stay generic across
 * all three types.
 * @param trx - An open Knex transaction.
 * @param type - Which mismatch comparison to build the query for.
 * @returns A `pages` query builder, filtered and column-aliased, but not yet
 *   bounded by `id`/`limit`/`orderBy` (added by the caller per chunk).
 */
function buildMismatchSourceQuery(
	trx: Knex,
	type: 'canonical' | 'og:title' | 'og:description',
): Knex.QueryBuilder {
	const base = trx('pages')
		.where({ scraped: 1, isExternal: 0, contentType: 'text/html' })
		.whereNull('redirectDestId');

	switch (type) {
		case 'canonical': {
			return base
				.whereNotNull('canonical')
				.whereNot('canonical', '')
				.whereRaw('canonical != url')
				.select('id', 'url', 'url as actual', 'canonical as expected');
		}
		case 'og:title': {
			return base
				.whereNotNull('og_title')
				.whereNot('og_title', '')
				.whereNotNull('title')
				.whereNot('title', '')
				.whereRaw('og_title != title')
				.select('id', 'url', 'og_title as actual', 'title as expected');
		}
		case 'og:description': {
			return base
				.whereNotNull('og_description')
				.whereNot('og_description', '')
				.whereNotNull('description')
				.whereNot('description', '')
				.whereRaw('og_description != description')
				.select('id', 'url', 'og_description as actual', 'description as expected');
		}
	}
}

/**
 * Scans `pages` once per mismatch type — `canonical`, then `og:title`, then
 * `og:description`, in that order — in `id`-keyset-bounded chunks (the same
 * `WHERE pages.id > :last ORDER BY pages.id LIMIT :size` idiom
 * `computeResourceInsertRows`/`computeDuplicateGroupPageRows` use), applying
 * the exact WHERE predicate `findMismatches` itself uses per type (see
 * `buildMismatchSourceQuery`).
 *
 * `mismatch_id` is left unassigned in every yielded row — SQLite's own
 * `AUTOINCREMENT` fills it in on insert, the same `viewer_anchor_facts.edge_id`
 * convention, since nothing in this read model needs to reference a mismatch
 * row by id before it is inserted (unlike `viewer_duplicate_groups.group_id`,
 * which `viewer_duplicate_group_pages` rows must reference up front).
 * @param trx - An open Knex transaction (a plain `Knex` instance also works,
 *   e.g. in tests that don't need transactional rollback).
 * @param chunkSize - Maximum `pages` rows read per chunk, per type. Must be
 *   positive — see `computeResourceInsertRows`'s docs for why. Defaults to
 *   {@link READ_CHUNK_SIZE}.
 * @yields {MismatchInsertRow[]} One chunk's insert rows for
 *   `viewer_mismatches`, at most `chunkSize` long, for one `type` at a time.
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * for await (const chunk of computeMismatchInsertRows(trx)) {
 *   await trx('viewer_mismatches').insert(chunk);
 * }
 */
export async function* computeMismatchInsertRows(
	trx: Knex,
	chunkSize = READ_CHUNK_SIZE,
): AsyncGenerator<MismatchInsertRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`computeMismatchInsertRows: chunkSize must be positive, got ${chunkSize}`,
		);
	}

	const types = ['canonical', 'og:title', 'og:description'] as const;
	for (const type of types) {
		let lastId = 0;
		for (;;) {
			const rows: MismatchSourceRow[] = await buildMismatchSourceQuery(trx, type)
				.where('pages.id', '>', lastId)
				.orderBy('pages.id', 'asc')
				.limit(chunkSize);

			if (rows.length === 0) {
				break;
			}
			lastId = rows.at(-1)!.id;

			yield rows.map((row) => ({
				type,
				page_id: row.id,
				url_sort_key: row.url,
				actual: row.actual,
				expected: row.expected,
			}));
		}
	}
}
