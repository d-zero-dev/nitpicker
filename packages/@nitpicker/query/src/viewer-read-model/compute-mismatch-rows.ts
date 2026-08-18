import type { Knex } from 'knex';

import { buildPageNaturalUrlRankMap } from './build-page-natural-url-rank-map.js';

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
	/**
	 * Zero-based rank in natural URL order across the DISTINCT pages of the
	 * whole `viewer_mismatches` population — every type combined (see
	 * {@link buildPageNaturalUrlRankMap}) — what `findMismatches`'s explicit
	 * `sortBy: 'url'` (natural sort via `orderByUrlRank`) orders by,
	 * persisted here so the fast path can serve that request.
	 *
	 * Whole-table (not per-type) ranking is load-bearing: `type` filters
	 * accept an array or "every type", and per-type ranks would interleave
	 * meaninglessly under a multi-type `ORDER BY` (each type's rank 0 is a
	 * different URL). A globally consistent rank stays correctly ordered
	 * under any type subset. Ranked independently of
	 * `viewer_pages.natural_url_rank`, though: mismatch predicates don't
	 * apply `viewer_pages`'s `alias_of_id IS NULL` restriction, so reusing
	 * the pages-level map could miss entries. The same page appearing under
	 * several types shares one rank — the `mismatch_id` keyset tie-breaker
	 * disambiguates those duplicates deterministically.
	 */
	natural_url_rank: number;
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
 * Two passes: a first lightweight pass reads only `(page_id, url)` per
 * matching row (chunked) to build the whole-population `natural_url_rank`
 * map (see {@link MismatchInsertRow.natural_url_rank} for why whole-table,
 * not per-type), then a second pass re-scans and streams full insert rows
 * chunk by chunk with the rank attached. The extra scan buys bounded peak
 * memory: only the `(id, url)` pairs are ever held at once, never the
 * `actual`/`expected` payload texts of every row — those stream through one
 * chunk at a time, the same profile the other `compute-*-rows` generators
 * keep for large archives.
 *
 * `mismatch_id` is left unassigned in every yielded row — SQLite's own
 * `AUTOINCREMENT` fills it in on insert.
 * @param trx - An open Knex transaction (a plain `Knex` instance also works,
 *   e.g. in tests that don't need transactional rollback).
 * @param chunkSize - Maximum rows read per source-scan chunk and yielded per
 *   insert chunk. Must be positive.
 * @param onProgress - Called after each of the 6 keyset scans (2 passes × 3
 *   types) completes, with the completed and total scan counts (issue #294)
 *   — see the in-function comment for why the unit is scans, not ids. Omit
 *   for no reporting (the default; e.g. tests).
 * @yields {MismatchInsertRow[]} One chunk's insert rows for
 *   `viewer_mismatches`, at most `chunkSize` long, for one `type` at a time.
 * @throws {RangeError} If `chunkSize` is not positive.
 */
export async function* computeMismatchInsertRows(
	trx: Knex,
	chunkSize = READ_CHUNK_SIZE,
	onProgress?: (completedScans: number, totalScans: number) => void,
): AsyncGenerator<MismatchInsertRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`computeMismatchInsertRows: chunkSize must be positive, got ${chunkSize}`,
		);
	}

	const types = ['canonical', 'og:title', 'og:description'] as const;

	// Progress unit = completed table scans (issue #294). This generator runs
	// 2 passes × 3 types = 6 keyset scans; per-scan id progress would reset
	// to zero five times (non-monotonic and confusing on a single-line
	// display), so the coarser scan count is reported instead.
	const totalScans = types.length * 2;
	let completedScans = 0;

	// Pass 1: rank map over the DISTINCT pages of the combined population.
	// Dedupe by page_id: the same page can fail several comparisons (one
	// row per type), and buildPageNaturalUrlRankMap keys by id — duplicates
	// share one rank, which the mismatch_id tie-breaker in the keyset tuple
	// then disambiguates.
	const distinctPages = new Map<number, { id: number; url: string }>();
	for (const type of types) {
		let lastId = 0;
		for (;;) {
			const rows: { id: number; url: string }[] = await buildMismatchSourceQuery(
				trx,
				type,
			)
				.clear('select')
				.select('ci.id as id', 'ur.url as url')
				.where('ci.id', '>', lastId)
				.orderBy('ci.id', 'asc')
				.limit(chunkSize);

			if (rows.length === 0) {
				break;
			}
			lastId = rows.at(-1)!.id;
			for (const row of rows) {
				distinctPages.set(row.id, { id: row.id, url: row.url });
			}
		}
		completedScans += 1;
		onProgress?.(completedScans, totalScans);
	}
	const naturalUrlRankByPageId = buildPageNaturalUrlRankMap([...distinctPages.values()]);

	// Pass 2: stream the full rows with the rank attached.
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
				// Non-null assertion is safe: pass 1 visited the same rows
				// (both passes run inside the caller's transaction, and the
				// per-type predicates are identical), so every id has an entry.
				natural_url_rank: naturalUrlRankByPageId.get(row.id)!,
			}));
		}
		completedScans += 1;
		onProgress?.(completedScans, totalScans);
	}
}
