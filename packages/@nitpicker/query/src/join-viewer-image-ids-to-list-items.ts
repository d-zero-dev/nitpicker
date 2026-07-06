import type { ImageEntry } from './types.js';
import type { Knex } from 'knex';

/** Row shape read from `images` joined to `pages`. */
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
 * wide write-model `images` table (plus `pages` for the display `pageUrl`)
 * for full-metadata display, per `docs/viewer-sql-query-plan.md`'s golden
 * rule ("URL/text JOINs only after IDs are limited"). `sourceCode` is
 * deliberately never selected here — the issue's Must list requires list
 * responses to never reconstruct it, matching `listImages`'s existing
 * behaviour.
 *
 * The `IN (...)` fetch does not itself preserve `imageIds`' order (SQLite
 * gives no such guarantee), so the result is re-sorted in JS by `imageIds`'
 * order afterward — cheap, since this only ever runs over a
 * `limit`-bounded page (≤ a few hundred rows), never the full archive.
 * @param knex - The archive's Knex instance.
 * @param imageIds - The image IDs to fetch, already filtered/sorted/limited
 *   by the `viewer_images` query stage.
 * @returns The corresponding {@link ImageEntry} rows, in `imageIds` order.
 */
export async function joinViewerImageIdsToListItems(
	knex: Knex,
	imageIds: number[],
): Promise<ImageEntry[]> {
	if (imageIds.length === 0) {
		return [];
	}
	const rows: ImageJoinRow[] = await knex('images')
		.join('pages', 'images.pageId', '=', 'pages.id')
		.whereIn('images.id', imageIds)
		.select(
			'images.id as id',
			'pages.url as pageUrl',
			'images.src as src',
			'images.currentSrc as currentSrc',
			'images.alt as alt',
			'images.width as width',
			'images.height as height',
			'images.naturalWidth as naturalWidth',
			'images.naturalHeight as naturalHeight',
			'images.isLazy as isLazy',
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
