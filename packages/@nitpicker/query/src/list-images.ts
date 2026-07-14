import type { ImageEntry, ListImagesOptions, PaginatedImageList } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyListOrder } from './apply-list-order.js';
import { paginateQuery } from './paginate-query.js';

/**
 * Lists images from the archive with filtering for common quality issues:
 * missing alt text, missing dimensions, oversized images, and lazy-loading gaps.
 *
 * 0.13: reads 0.13 `image_items` joined to `url_refs` (for
 * regular URL-shaped `src`/`currentSrc` — the common case) and
 * `text_refs` (for `alt`). Data-URI `src`/`currentSrc` values (> 512
 * bytes) live on `blob_refs` and are not decoded in SQL — the caller
 * receives `null` for those, matching the pre-6 shape where the writer
 * previously stored the data-URI inline. A follow-up can add
 * zstd-decompression in JS if callers need the raw data URI back.
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

	const baseQuery = knex('image_items as ii')
		.join('content_items as ci', 'ii.page_id', 'ci.id')
		.join('url_refs as page_ur', 'page_ur.id', 'ci.url_id')
		.leftJoin('url_refs as src_ur', 'src_ur.id', 'ii.src_url_id')
		.leftJoin('url_refs as current_src_ur', 'current_src_ur.id', 'ii.current_src_url_id')
		.leftJoin('text_refs as alt_ref', 'alt_ref.id', 'ii.alt_text_id');

	if (options.missingAlt != null) {
		if (options.missingAlt) {
			baseQuery.where((qb) => {
				qb.whereNull('alt_ref.text').orWhere('alt_ref.text', '');
			});
		} else {
			baseQuery.where((qb) => {
				qb.whereNotNull('alt_ref.text').andWhere('alt_ref.text', '!=', '');
			});
		}
	}
	if (options.missingDimensions != null) {
		if (options.missingDimensions) {
			baseQuery.where((qb) => {
				qb.where('ii.width', 0).orWhere('ii.height', 0);
			});
		} else {
			baseQuery.where((qb) => {
				qb.where('ii.width', '!=', 0).andWhere('ii.height', '!=', 0);
			});
		}
	}
	if (options.oversizedThreshold != null) {
		const threshold = options.oversizedThreshold;
		baseQuery.where((qb) => {
			qb.where('ii.natural_width', '>', threshold).orWhere(
				'ii.natural_height',
				'>',
				threshold,
			);
		});
	}
	if (options.urlPattern) {
		baseQuery.where('src_ur.url', 'like', options.urlPattern);
	}
	const sortBy = options.sortBy ?? 'pageUrl';
	const sortOrder = options.sortOrder ?? 'asc';
	const useUrlSort = options.sortBy != null;

	return paginateQuery<
		{
			pageUrl: string;
			src: string | null;
			currentSrc: string | null;
			alt: string | null;
			width: number;
			height: number;
			naturalWidth: number;
			naturalHeight: number;
			isLazy: number | null;
		},
		ImageEntry
	>({
		baseQuery,
		countColumn: 'ii.id',
		applySelect: (q) => {
			q.select(
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
			return applyListOrder(q, knex, sortBy, sortOrder, {
				pageUrl: { column: '"page_ur"."url"', type: useUrlSort ? 'url' : 'plain' },
				src: { column: '"src_ur"."url"', type: 'url' },
				alt: { column: '"alt_ref"."text"' },
				width: { column: '"ii"."width"' },
				height: { column: '"ii"."height"' },
				naturalWidth: { column: '"ii"."natural_width"' },
				naturalHeight: { column: '"ii"."natural_height"' },
				isLazy: { column: '"ii"."is_lazy"' },
			});
		},
		limit,
		offset,
		mapRow: (row) => ({
			pageUrl: row.pageUrl,
			src: row.src,
			currentSrc: row.currentSrc,
			alt: row.alt,
			width: row.width,
			height: row.height,
			naturalWidth: row.naturalWidth,
			naturalHeight: row.naturalHeight,
			isLazy: !!row.isLazy,
		}),
	});
}
