import type { ArchiveAccessor } from '@nitpicker/crawler';

/** `image_items` rows read per keyset chunk, by default. */
const READ_CHUNK_SIZE = 5000;

/** One image's display fields for the Images report sheet. */
export interface ImageStreamRow {
	/** The URL of the page the image appears on. */
	pageUrl: string;
	/** Resolved `src` attribute value, or `null` for a data-URI/blob-routed image (see `create-cell-data.ts`'s docs on blob-routed values). */
	src: string | null;
	/** Resolved `currentSrc` value, or `null` for a data-URI/blob-routed image. */
	currentSrc: string | null;
	/** `alt` attribute text. */
	alt: string | null;
	/** Displayed width in CSS pixels. */
	width: number;
	/** Displayed height in CSS pixels. */
	height: number;
	/** Whether the image was `loading="lazy"`. */
	isLazy: boolean;
	/** Stable structural DOM locator (e.g. `html/body[1]/main[1]/img[1]`). */
	domPath: string | null;
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
 * @param chunkSize - `image_items` rows read per chunk. Must be positive.
 * @yields One chunk's rows, in `image_items.id` order.
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * for await (const chunk of streamAllImages(accessor)) {
 *   for (const image of chunk) {
 *     sheet.appendRow(toImageRow(image));
 *   }
 * }
 */
export async function* streamAllImages(
	accessor: ArchiveAccessor,
	chunkSize = READ_CHUNK_SIZE,
): AsyncGenerator<ImageStreamRow[]> {
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
