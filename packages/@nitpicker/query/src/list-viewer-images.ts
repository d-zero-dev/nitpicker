import type { CursorPaginatedImageList, ListViewerImagesOptions } from './types.js';
import type {
	ViewerImagesKeysetRow,
	ViewerImagesSortSpec,
} from './viewer-images-cursor/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { applyViewerImagesFilters } from './apply-viewer-images-filters.js';
import { countViewerImagesTotal } from './count-viewer-images-total.js';
import { joinViewerImageIdsToListItems } from './join-viewer-image-ids-to-list-items.js';
import { readKeysetWindow } from './viewer-cursor-kit/read-keyset-window.js';
import { buildViewerImagesFilterKey } from './viewer-images-cursor/build-viewer-images-filter-key.js';
import { decodeViewerImagesCursor } from './viewer-images-cursor/decode-viewer-images-cursor.js';
import { encodeViewerImagesCursor } from './viewer-images-cursor/encode-viewer-images-cursor.js';
import { extractSortValues } from './viewer-images-cursor/extract-sort-values.js';
import { getViewerImagesSortSpec } from './viewer-images-cursor/get-viewer-images-sort-spec.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model/viewer-read-model-schema-version.js';

/**
 * Runs one `viewer_images` id-resolution read via the shared
 * {@link readKeysetWindow}: applies filters, an optional keyset predicate,
 * an `ORDER BY` in `orderDirection`, and `limit + 1` rows (the `+1` lets the
 * caller detect "is there another row past this page" without a second
 * query).
 * @param knex - The archive's Knex instance.
 * @param options - The caller's filter options.
 * @param spec - The resolved sort spec (columns to select/order by).
 * @param orderDirection - The physical scan direction for this read.
 * @param limit - The page size (the read fetches `limit + 1` rows).
 * @param keyset - The keyset predicate to apply, or `undefined` for an
 *   unconstrained (initial / offset) read.
 * @param offset - Row offset for a direct `OFFSET` read (page-number jumps).
 *   Ignored when `keyset` is supplied.
 * @returns Up to `limit + 1` rows carrying `image_id` and every sort column.
 */
async function readViewerImagesWindow(
	knex: Knex,
	options: ListViewerImagesOptions,
	spec: ViewerImagesSortSpec,
	orderDirection: 'asc' | 'desc',
	limit: number,
	keyset: { operator: '>' | '<'; values: readonly (string | number)[] } | undefined,
	offset: number,
): Promise<ViewerImagesKeysetRow[]> {
	return readKeysetWindow(
		knex,
		'viewer_images',
		(qb) => applyViewerImagesFilters(qb, options),
		['image_id'],
		spec,
		orderDirection,
		limit,
		keyset,
		offset,
	);
}

/**
 * Builds the final {@link CursorPaginatedImageList}: joins the resolved
 * `image_id` window back to full image metadata, and mints
 * `nextCursor`/`prevCursor` from the window's boundary rows.
 * @param knex - The archive's Knex instance.
 * @param window - Up to `limit + 1` rows from {@link readViewerImagesWindow},
 *   already trimmed to at most `limit` and in FINAL display order.
 * @param context - Shared cursor/response context.
 * @param context.spec - The resolved sort spec.
 * @param context.filterKey - See `buildViewerImagesFilterKey`.
 * @param context.sortBy - The effective sort field.
 * @param context.sortOrder - The effective sort direction.
 * @param context.total - The total matching row count.
 * @param context.limit - The effective page size.
 * @param context.offset - The effective `offset` to echo in the response.
 * @param context.hasMoreAfter - Whether a subsequent page exists.
 * @param context.hasMoreBefore - Whether a preceding page exists.
 * @returns The full paginated result.
 */
async function buildCursorPaginatedResult(
	knex: Knex,
	window: ViewerImagesKeysetRow[],
	context: {
		spec: ViewerImagesSortSpec;
		filterKey: string;
		sortBy: NonNullable<ListViewerImagesOptions['sortBy']>;
		sortOrder: 'asc' | 'desc';
		total: number;
		limit: number;
		offset: number;
		hasMoreAfter: boolean;
		hasMoreBefore: boolean;
	},
): Promise<CursorPaginatedImageList> {
	const {
		spec,
		filterKey,
		sortBy,
		sortOrder,
		total,
		limit,
		offset,
		hasMoreAfter,
		hasMoreBefore,
	} = context;
	const items = await joinViewerImageIdsToListItems(
		knex,
		window.map((row) => row.image_id),
	);
	const lastRow = window.at(-1);
	const firstRow = window[0];
	const nextCursor =
		hasMoreAfter && lastRow
			? encodeViewerImagesCursor({
					v: VIEWER_READ_MODEL_SCHEMA_VERSION,
					filterKey,
					sortBy,
					sortOrder,
					values: extractSortValues(spec, lastRow),
				})
			: null;
	const prevCursor =
		hasMoreBefore && firstRow
			? encodeViewerImagesCursor({
					v: VIEWER_READ_MODEL_SCHEMA_VERSION,
					filterKey,
					sortBy,
					sortOrder,
					values: extractSortValues(spec, firstRow),
				})
			: null;
	return { items, total, offset, limit, nextCursor, prevCursor };
}

/**
 * Lists images from `viewer_images` — the read-model-backed, cursor-paginated
 * counterpart of `listImages` that powers `/api/images`'s fast path (issue
 * #113).
 *
 * Filter/sort resolution runs entirely against the narrow, indexed
 * `viewer_images` table; the wide write-model `images` table (plus `pages`
 * for the display URL) is joined only after the id set is `limit`-bounded
 * (see `joinViewerImageIdsToListItems`). The initial read (no `cursor`), the
 * forward keyset read, the backward keyset read, and the direct-`offset`
 * read are four separate code paths — no `(:cursor IS NULL OR …)`-style
 * nullable predicate ties them together (same structure as
 * `listViewerResources`/`listViewerPages`).
 *
 * `options.cursor` takes priority over `options.offset` when both are
 * supplied.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current (see
 *   `isViewerReadModelCurrent`) before calling this — it assumes
 *   `viewer_images` exists and trusts their content.
 * @param options - Filter, sort, and pagination options.
 * @returns A cursor-paginated list of image entries, response-shape-compatible
 *   with `listImages`'s `PaginatedImageList` plus `nextCursor`/`prevCursor`.
 * @throws {Error} If `options.cursor` is malformed, stale, or was minted
 *   under a different filter/sort combination.
 * @example
 * const page1 = await listViewerImages(accessor, { limit: 100 });
 * const page2 = page1.nextCursor
 *   ? await listViewerImages(accessor, { limit: 100, cursor: page1.nextCursor })
 *   : null;
 */
export async function listViewerImages(
	accessor: ArchiveAccessor,
	options: ListViewerImagesOptions = {},
): Promise<CursorPaginatedImageList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const sortBy = options.sortBy ?? 'pageUrl';
	const sortOrder = options.sortOrder ?? 'asc';
	const spec = getViewerImagesSortSpec(sortBy, sortOrder);
	const filterKey = buildViewerImagesFilterKey(options);

	const total = await countViewerImagesTotal(knex, options);

	if (options.cursor) {
		const decoded = decodeViewerImagesCursor(options.cursor, {
			filterKey,
			sortBy,
			sortOrder,
			expectedValueCount: spec.columns.length,
		});
		if (options.direction === 'prev') {
			const oppositeDirection = spec.scanDirection === 'asc' ? 'desc' : 'asc';
			const fetched = await readViewerImagesWindow(
				knex,
				options,
				spec,
				oppositeDirection,
				limit,
				{ operator: spec.scanDirection === 'asc' ? '<' : '>', values: decoded.values },
				0,
			);
			const hasMoreBefore = fetched.length > limit;
			const window = fetched.slice(0, limit).toReversed();
			return buildCursorPaginatedResult(knex, window, {
				spec,
				filterKey,
				sortBy,
				sortOrder,
				total,
				limit,
				offset: options.offset ?? 0,
				hasMoreAfter: true,
				hasMoreBefore,
			});
		}
		const fetched = await readViewerImagesWindow(
			knex,
			options,
			spec,
			spec.scanDirection,
			limit,
			{ operator: spec.scanDirection === 'asc' ? '>' : '<', values: decoded.values },
			0,
		);
		const hasMoreAfter = fetched.length > limit;
		const window = fetched.slice(0, limit);
		return buildCursorPaginatedResult(knex, window, {
			spec,
			filterKey,
			sortBy,
			sortOrder,
			total,
			limit,
			offset: options.offset ?? 0,
			hasMoreAfter,
			hasMoreBefore: true,
		});
	}

	const offset = options.offset ?? 0;
	const fetched = await readViewerImagesWindow(
		knex,
		options,
		spec,
		spec.scanDirection,
		limit,
		undefined,
		offset,
	);
	const hasMoreAfter = fetched.length > limit;
	const window = fetched.slice(0, limit);
	return buildCursorPaginatedResult(knex, window, {
		spec,
		filterKey,
		sortBy,
		sortOrder,
		total,
		limit,
		offset,
		hasMoreAfter,
		hasMoreBefore: offset > 0,
	});
}
