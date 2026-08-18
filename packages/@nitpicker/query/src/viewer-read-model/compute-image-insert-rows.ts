import type { ImageInsertRow } from './types.js';
import type { Knex } from 'knex';

/** Rows read per `image_items` scan chunk, by default. */
const READ_CHUNK_SIZE = 20_000;

/** Sentinel rank for an image whose `page_id` is absent from the page-rank map (defensive only — see docs below). */
const MISSING_PAGE_RANK_SENTINEL = Number.MAX_SAFE_INTEGER;

/**
 * Computes insert rows for `viewer_images` (issue #113).
 *
 * Reads the 0.13 `image_items` table (the legacy `images` table's
 * replacement) and resolves `alt_text_id` through `text_refs`. Every
 * image_items row carries either `src_url_id` XOR `src_blob_id` — those are
 * not consumed here (viewer_images only records the presence-of-alt /
 * missing-dimensions flags plus width/height/lazy), so we do not join
 * `url_refs`/`blob_refs`.
 *
 * Chunking is plain `id`-based keyset pagination
 * (`WHERE image_items.id > :last ORDER BY image_items.id LIMIT :size`), the
 * same idiom as `computeResourceInsertRows` — safe here because
 * `viewer_images` has exactly one output row per `image_items` row (no
 * `GROUP BY` aggregation that a `LIMIT` could split mid-group).
 * @param trx - An open Knex transaction (a plain `Knex` instance also works,
 *   e.g. in tests).
 * @param pageUrlRankById - Every listable page's URL-ascending rank, from
 *   `buildPageUrlRankMap`. An image whose `page_id` is absent (defensive
 *   only) gets {@link MISSING_PAGE_RANK_SENTINEL}.
 * @param chunkSize - Maximum `image_items` rows read per chunk. Must be
 *   positive.
 * @param onProgress - Called after each keyset chunk with the
 *   `image_items.id` scanned up to so far and the max id (issue #294:
 *   `image_items` is the largest write-model table, so this scan runs for
 *   minutes on a large archive with no other signal it hasn't hung). Omit
 *   for no reporting (the default; e.g. tests).
 * @yields {ImageInsertRow[]} One chunk's insert rows for `viewer_images`.
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
	onProgress?: (scannedUpToId: number, maxId: number) => void,
): AsyncGenerator<ImageInsertRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`computeImageInsertRows: chunkSize must be positive, got ${chunkSize}`,
		);
	}

	// MAX() over the keyset column is an O(1) index-tail read; only fetched
	// when someone is listening.
	let maxId = 0;
	if (onProgress) {
		const [maxRow] = await trx('image_items').max<{ max: number | null }[]>({
			max: 'id',
		});
		maxId = maxRow?.max ?? 0;
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
		}[] = await trx('image_items as ii')
			.leftJoin('text_refs as alt_ref', 'alt_ref.id', 'ii.alt_text_id')
			.where('ii.id', '>', lastId)
			.orderBy('ii.id', 'asc')
			.limit(chunkSize)
			.select(
				'ii.id as id',
				'ii.page_id as pageId',
				'alt_ref.text as alt',
				'ii.width as width',
				'ii.height as height',
				'ii.natural_width as naturalWidth',
				'ii.natural_height as naturalHeight',
				'ii.is_lazy as isLazy',
			);

		if (rows.length === 0) {
			onProgress?.(maxId, maxId);
			return;
		}
		lastId = rows.at(-1)!.id;
		onProgress?.(Math.min(lastId, maxId), maxId);

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
