import type { ImageEntry } from './types.js';
import type { Knex } from 'knex';

/** Row shape read from `image_items` joined to page + ref tables. */
interface ImageJoinRow {
	id: number;
	pageUrl: string;
	src: string | null;
	currentSrc: string | null;
	alt: string | null;
	width: number;
	height: number;
	naturalWidth: number;
	naturalHeight: number;
	isLazy: number | null;
}

/**
 * Joins an already ID-limited, already-ordered `image_id` list back to the
 * 0.13 `image_items` write model (plus `content_items` + `url_refs`
 * for the display `pageUrl`) for full-metadata display. Data-URI
 * `src`/`currentSrc` values live on `blob_refs` and are not decoded in SQL —
 * callers receive `null` for those (see `list-images.ts`).
 * @param knex - The archive's Knex instance.
 * @param imageIds - The image IDs to fetch.
 * @returns The corresponding {@link ImageEntry} rows, in `imageIds` order.
 */
export async function joinViewerImageIdsToListItems(
	knex: Knex,
	imageIds: number[],
): Promise<ImageEntry[]> {
	if (imageIds.length === 0) {
		return [];
	}
	const rows: ImageJoinRow[] = await knex('image_items as ii')
		.join('content_items as ci', 'ii.page_id', 'ci.id')
		.join('url_refs as page_ur', 'page_ur.id', 'ci.url_id')
		.leftJoin('url_refs as src_ur', 'src_ur.id', 'ii.src_url_id')
		.leftJoin('url_refs as current_src_ur', 'current_src_ur.id', 'ii.current_src_url_id')
		.leftJoin('text_refs as alt_ref', 'alt_ref.id', 'ii.alt_text_id')
		.whereIn('ii.id', imageIds)
		.select(
			'ii.id as id',
			'page_ur.url as pageUrl',
			'src_ur.url as src',
			'current_src_ur.url as currentSrc',
			'alt_ref.text as alt',
			'ii.width as width',
			'ii.height as height',
			'ii.natural_width as naturalWidth',
			'ii.natural_height as naturalHeight',
			'ii.is_lazy as isLazy',
		);
	const rowsById = new Map(rows.map((row) => [row.id, row]));
	return imageIds
		.map((id) => rowsById.get(id))
		.filter((row): row is ImageJoinRow => row != null)
		.map((row) => ({
			pageUrl: row.pageUrl,
			src: row.src,
			currentSrc: row.currentSrc,
			alt: row.alt,
			width: row.width,
			height: row.height,
			naturalWidth: row.naturalWidth,
			naturalHeight: row.naturalHeight,
			isLazy: !!row.isLazy,
		}));
}
