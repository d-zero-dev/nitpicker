import type { ImageStreamRow } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyEqualityOrInFilter } from '../apply-equality-or-in-filter.js';

/** `image_items` rows read per keyset chunk, by default. */
const READ_CHUNK_SIZE = 5000;

/** Options for {@link streamAllImages}. */
export interface StreamAllImagesOptions {
	/** `image_items` rows read per chunk. Must be positive. Defaults to {@link READ_CHUNK_SIZE}. */
	chunkSize?: number;
	/**
	 * Exact-match page URL allowlist, already normalized (see
	 * `resolvePageListUrlFilter`) — filters on the *page* the image appears
	 * on, not the image's own `src`. Omitted or empty streams every image,
	 * matching the pre-existing behavior.
	 */
	urls?: readonly string[];
}

/**
 * Streams every `image_items` row for the Images report sheet.
 *
 * Plain `image_items.id` keyset pagination (`id > lastId`), matching
 * `streamAllResourcesRaw`/`streamAllViolations`: the report has no filter UI
 * and always wants every image in one linear sweep, so this bypasses the
 * viewer UI's `listViewerImages` (which recomputes `countViewerImagesTotal`'s
 * `COUNT(*)` on every page — appropriate for a small UI page, not a
 * full-archive report pass).
 * @param accessor - The archive accessor to query.
 * @param options - Read size and page-URL allowlist. Defaults to the whole
 *   archive read in {@link READ_CHUNK_SIZE}-row chunks.
 * @yields One chunk's rows, in `image_items.id` order.
 * @throws {RangeError} If `options.chunkSize` is not positive.
 * @example
 * for await (const chunk of streamAllImages(accessor)) {
 *   for (const image of chunk) {
 *     sheet.appendRow(toImageRow(image));
 *   }
 * }
 */
export async function* streamAllImages(
	accessor: ArchiveAccessor,
	options: StreamAllImagesOptions = {},
): AsyncGenerator<ImageStreamRow[]> {
	const chunkSize = options.chunkSize ?? READ_CHUNK_SIZE;
	if (chunkSize <= 0) {
		throw new RangeError(`streamAllImages: chunkSize must be positive, got ${chunkSize}`);
	}
	const knex = accessor.getKnex();

	let lastId = 0;
	for (;;) {
		const rows: {
			id: number;
			pageUrl: string;
			src: string | null;
			currentSrc: string | null;
			alt: string | null;
			width: number;
			height: number;
			isLazy: number | null;
			domPath: string | null;
		}[] = await knex('image_items as ii')
			.join('content_items as ci', 'ii.page_id', 'ci.id')
			.join('url_refs as page_ur', 'page_ur.id', 'ci.url_id')
			.leftJoin('url_refs as src_ur', 'src_ur.id', 'ii.src_url_id')
			.leftJoin(
				'url_refs as current_src_ur',
				'current_src_ur.id',
				'ii.current_src_url_id',
			)
			.leftJoin('text_refs as alt_ref', 'alt_ref.id', 'ii.alt_text_id')
			.leftJoin('text_refs as dom_path_ref', 'dom_path_ref.id', 'ii.dom_path_text_id')
			.where('ii.id', '>', lastId)
			.modify((qb) => applyEqualityOrInFilter(qb, 'page_ur.url', options.urls))
			.orderBy('ii.id', 'asc')
			.limit(chunkSize)
			.select(
				'ii.id as id',
				'page_ur.url as pageUrl',
				'src_ur.url as src',
				'current_src_ur.url as currentSrc',
				'alt_ref.text as alt',
				'ii.width as width',
				'ii.height as height',
				'ii.is_lazy as isLazy',
				'dom_path_ref.text as domPath',
			);

		if (rows.length === 0) {
			return;
		}
		lastId = rows.at(-1)!.id;

		yield rows.map((row) => ({
			pageUrl: row.pageUrl,
			src: row.src,
			currentSrc: row.currentSrc,
			alt: row.alt,
			width: row.width,
			height: row.height,
			isLazy: !!row.isLazy,
			domPath: row.domPath,
		}));
	}
}
