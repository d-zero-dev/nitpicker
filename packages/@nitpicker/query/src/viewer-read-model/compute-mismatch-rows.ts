import type { Knex } from 'knex';

/** Rows read per `content_items` id-keyset scan chunk, by default. */
const READ_CHUNK_SIZE = 20_000;

/** One row to insert into `viewer_mismatches`, produced by `computeMismatchInsertRows`. */
export interface MismatchInsertRow {
	/** Which metadata comparison this row failed. */
	type: 'canonical' | 'og:title' | 'og:description';
	/** The write-model page id (== `content_items.id` == legacy `pages.id`) this row represents. */
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

/** One raw source row read for one mismatch `type`'s chunk scan, pre-aliased to `actual`/`expected`. */
interface MismatchSourceRow {
	id: number;
	url: string;
	actual: string | null;
	expected: string | null;
}

/**
 * Builds the filtered (but not yet chunk-bounded) query for one mismatch
 * `type` — the exact WHERE predicate `findMismatches` itself uses for that
 * type (base `scraped = 1, is_external = 0, content_type='text/html',
 * redirect_dest_id IS NULL` plus the type's own non-null/non-empty `!=`
 * comparison via 0.13 `page_meta` ref columns), with columns
 * pre-aliased to `actual`/`expected`.
 *
 * The comparisons run on integer ref ids rather than the strings they
 * dedupe: `page_meta.canonical_url_id != content_items.url_id` is
 * equivalent to `pages.canonical != pages.url` because `url_refs` is unique
 * per URL, and `page_meta.og_title_text_id != page_meta.title_text_id` is
 * equivalent to `pages.og_title != pages.title` because `text_refs` is
 * unique per text.
 * @param trx - An open Knex transaction.
 * @param type - Which mismatch comparison to build the query for.
 * @returns A source-query builder, filtered and column-aliased, but not yet
 *   bounded by `id`/`limit`/`orderBy` (added by the caller per chunk).
 */
function buildMismatchSourceQuery(
	trx: Knex,
	type: 'canonical' | 'og:title' | 'og:description',
): Knex.QueryBuilder {
	const base = trx('content_items as ci')
		.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
		.join('page_meta as pm', 'pm.page_id', 'ci.id')
		.join('url_refs as ur', 'ur.id', 'ci.url_id')
		.where({ 'ci.scraped': 1, 'ci.is_external': 0, 'ctr.raw': 'text/html' })
		.whereNull('ci.redirect_dest_id');

	switch (type) {
		case 'canonical': {
			return base
				.join('url_refs as canonical_ur', 'canonical_ur.id', 'pm.canonical_url_id')
				.whereNotNull('pm.canonical_url_id')
				.whereNot('canonical_ur.url', '')
				.whereRaw('"pm"."canonical_url_id" != "ci"."url_id"')
				.select(
					'ci.id as id',
					'ur.url as url',
					'ur.url as actual',
					'canonical_ur.url as expected',
				);
		}
		case 'og:title': {
			return base
				.join('text_refs as og_tr', 'og_tr.id', 'pm.og_title_text_id')
				.join('text_refs as title_tr', 'title_tr.id', 'pm.title_text_id')
				.whereNotNull('pm.og_title_text_id')
				.whereNot('og_tr.text', '')
				.whereNotNull('pm.title_text_id')
				.whereNot('title_tr.text', '')
				.whereRaw('"pm"."og_title_text_id" != "pm"."title_text_id"')
				.select(
					'ci.id as id',
					'ur.url as url',
					'og_tr.text as actual',
					'title_tr.text as expected',
				);
		}
		case 'og:description': {
			return base
				.join('text_refs as og_tr', 'og_tr.id', 'pm.og_description_text_id')
				.join('text_refs as desc_tr', 'desc_tr.id', 'pm.description_text_id')
				.whereNotNull('pm.og_description_text_id')
				.whereNot('og_tr.text', '')
				.whereNotNull('pm.description_text_id')
				.whereNot('desc_tr.text', '')
				.whereRaw('"pm"."og_description_text_id" != "pm"."description_text_id"')
				.select(
					'ci.id as id',
					'ur.url as url',
					'og_tr.text as actual',
					'desc_tr.text as expected',
				);
		}
	}
}

/**
 * Scans `content_items` once per mismatch type — `canonical`, then
 * `og:title`, then `og:description`, in that order — in `id`-keyset-bounded
 * chunks. Applies the exact WHERE predicate `findMismatches` itself uses
 * per type (see {@link buildMismatchSourceQuery}).
 *
 * `mismatch_id` is left unassigned in every yielded row — SQLite's own
 * `AUTOINCREMENT` fills it in on insert.
 * @param trx - An open Knex transaction (a plain `Knex` instance also works,
 *   e.g. in tests that don't need transactional rollback).
 * @param chunkSize - Maximum rows read per chunk, per type. Must be
 *   positive.
 * @yields {MismatchInsertRow[]} One chunk's insert rows for
 *   `viewer_mismatches`, at most `chunkSize` long, for one `type` at a time.
 * @throws {RangeError} If `chunkSize` is not positive.
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
				.where('ci.id', '>', lastId)
				.orderBy('ci.id', 'asc')
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
