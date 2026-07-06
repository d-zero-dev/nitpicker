import type { ImageInsertRow } from './types.js';
import type { Knex } from 'knex';

/** Rows read per `images` scan chunk, by default. */
const READ_CHUNK_SIZE = 20_000;

/** Sentinel rank for an image whose `pageId` is absent from the page-rank map (defensive only — see docs below). */
const MISSING_PAGE_RANK_SENTINEL = Number.MAX_SAFE_INTEGER;

/**
 * Computes insert rows for `viewer_images` (issue #113), reading `images` in
 * bounded chunks instead of one unbounded `SELECT` — mirroring
 * `computeResourceInsertRows`'s chunking pattern. `images` is the largest
 * write-model table (measured at ~9.11M rows / 3.25GB on a real archive —
 * see `docs/viewer-db-redesign-plan.md`), so an unbounded single-query read
 * here risks the same OOM class PR #168/#172 fixed for URL sorting and the
 * anchor-facts/resources read-model builds.
 *
 * Chunking is plain `id`-based keyset pagination
 * (`WHERE images.id > :last ORDER BY images.id LIMIT :size`), the same
 * idiom as `computeResourceInsertRows` — safe here because `viewer_images`
 * has exactly one output row per `images` row (no `GROUP BY` aggregation
 * that a `LIMIT` could split mid-group).
 * @param trx - An open Knex transaction (a plain `Knex` instance also works,
 *   e.g. in tests).
 * @param pageUrlRankById - Every listable page's URL-ascending rank, from
 *   `buildPageUrlRankMap`. An image whose `pageId` is absent (defensive
 *   only — every image is written against a page that was scraped in the
 *   same crawl, so this should not be reachable in practice) gets
 *   {@link MISSING_PAGE_RANK_SENTINEL} instead of throwing, sorting such
 *   images last rather than failing the whole read-model build.
 * @param chunkSize - Maximum `images` rows read per chunk. Must be
 *   positive — `.limit(0)` would return zero rows on the very first
 *   iteration (indistinguishable from "no more images", so the generator
 *   would silently yield nothing instead of throwing), and SQLite treats a
 *   negative `LIMIT` as unlimited (silently reintroducing the unbounded
 *   single-query read this chunking exists to avoid). Defaults to
 *   {@link READ_CHUNK_SIZE}; overridable for tests that need to exercise
 *   chunk boundaries against a small fixture.
 * @yields {ImageInsertRow[]} One chunk's insert rows for `viewer_images`, at
 *   most `chunkSize` images long.
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * const pageUrlRankById = buildPageUrlRankMap(sourceRows);
 * for await (const chunk of computeImageInsertRows(trx, pageUrlRankById)) {
 *   await trx('viewer_images').insert(chunk);
 * }
 */
export async function* computeImageInsertRows(
	trx: Knex,
	pageUrlRankById: ReadonlyMap<number, number>,
	chunkSize = READ_CHUNK_SIZE,
): AsyncGenerator<ImageInsertRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`computeImageInsertRows: chunkSize must be positive, got ${chunkSize}`,
		);
	}

	let lastId = 0;
	for (;;) {
		const rows: {
			id: number;
			pageId: number;
			alt: string | null;
			width: number;
			height: number;
			naturalWidth: number;
			naturalHeight: number;
			isLazy: number | null;
		}[] = await trx('images')
			.where('images.id', '>', lastId)
			.orderBy('images.id', 'asc')
			.limit(chunkSize)
			.select(
				'images.id as id',
				'images.pageId as pageId',
				'images.alt as alt',
				'images.width as width',
				'images.height as height',
				'images.naturalWidth as naturalWidth',
				'images.naturalHeight as naturalHeight',
				'images.isLazy as isLazy',
			);

		if (rows.length === 0) {
			return;
		}
		lastId = rows.at(-1)!.id;

		yield rows.map((row): ImageInsertRow => {
			return {
				image_id: row.id,
				page_url_rank: pageUrlRankById.get(row.pageId) ?? MISSING_PAGE_RANK_SENTINEL,
				missing_alt: row.alt == null || row.alt === '' ? 1 : 0,
				missing_dimensions: row.width === 0 || row.height === 0 ? 1 : 0,
				width: row.width,
				height: row.height,
				natural_width: row.naturalWidth,
				natural_height: row.naturalHeight,
				is_lazy: row.isLazy ? 1 : 0,
			};
		});
	}
}
