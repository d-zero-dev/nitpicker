import type { ImageEntry, ListImagesOptions, PaginatedImageList } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Lists images from the archive with filtering for common quality issues:
 * missing alt text, missing dimensions, oversized images, and lazy-loading gaps.
 * @param accessor - The archive accessor to query.
 * @param options - Filter and pagination options.
 * @returns A paginated list of image entries.
 */
export async function listImages(
	accessor: ArchiveAccessor,
	options: ListImagesOptions = {},
): Promise<PaginatedImageList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;

	const baseQuery = knex('images').join('pages', 'images.pageId', '=', 'pages.id');

	if (options.missingAlt) {
		baseQuery.where((qb) => {
			qb.whereNull('images.alt').orWhere('images.alt', '');
		});
	}
	if (options.missingDimensions) {
		baseQuery.where((qb) => {
			qb.where('images.width', 0).orWhere('images.height', 0);
		});
	}
	if (options.oversizedThreshold != null) {
		baseQuery.where((qb) => {
			qb.where('images.naturalWidth', '>', options.oversizedThreshold!).orWhere(
				'images.naturalHeight',
				'>',
				options.oversizedThreshold!,
			);
		});
	}
	if (options.urlPattern) {
		baseQuery.where('images.src', 'like', options.urlPattern);
	}

	const countResult = (await baseQuery
		.clone()
		.clearSelect()
		.count('images.id as total')) as { total: number }[];
	const total = countResult[0]!.total;

	const rows = await baseQuery
		.clone()
		.select(
			'pages.url as pageUrl',
			'images.src',
			'images.alt',
			'images.width',
			'images.height',
			'images.naturalWidth',
			'images.naturalHeight',
			'images.isLazy',
		)
		.orderBy('pages.url')
		.limit(limit)
		.offset(offset);

	const items: ImageEntry[] = rows.map(
		(row: {
			pageUrl: string;
			src: string | null;
			alt: string | null;
			width: number;
			height: number;
			naturalWidth: number;
			naturalHeight: number;
			isLazy: number | null;
		}) => ({
			pageUrl: row.pageUrl,
			src: row.src,
			alt: row.alt,
			width: row.width,
			height: row.height,
			naturalWidth: row.naturalWidth,
			naturalHeight: row.naturalHeight,
			isLazy: !!row.isLazy,
		}),
	);

	return {
		items,
		total: Number(total),
		offset,
		limit,
	};
}
