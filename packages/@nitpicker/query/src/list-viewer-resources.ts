import type { CursorPaginatedResourceList, ListViewerResourcesOptions } from './types.js';
import type {
	ViewerResourcesKeysetRow,
	ViewerResourcesSortSpec,
} from './viewer-resources-cursor/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { applyViewerResourcesFilters } from './apply-viewer-resources-filters.js';
import { countViewerResourcesTotal } from './count-viewer-resources-total.js';
import { joinViewerResourceIdsToListItems } from './join-viewer-resource-ids-to-list-items.js';
import { readKeysetWindow } from './viewer-cursor-kit/read-keyset-window.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model/viewer-read-model-schema-version.js';
import { buildViewerResourcesFilterKey } from './viewer-resources-cursor/build-viewer-resources-filter-key.js';
import { decodeViewerResourcesCursor } from './viewer-resources-cursor/decode-viewer-resources-cursor.js';
import { encodeViewerResourcesCursor } from './viewer-resources-cursor/encode-viewer-resources-cursor.js';
import { extractSortValues } from './viewer-resources-cursor/extract-sort-values.js';
import { getViewerResourcesSortSpec } from './viewer-resources-cursor/get-viewer-resources-sort-spec.js';

/**
 * Runs one `viewer_resources` id-resolution read via the shared
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
 * @returns Up to `limit + 1` rows carrying `resource_id` and every sort column.
 */
async function readViewerResourcesWindow(
	knex: Knex,
	options: ListViewerResourcesOptions,
	spec: ViewerResourcesSortSpec,
	orderDirection: 'asc' | 'desc',
	limit: number,
	keyset: { operator: '>' | '<'; values: readonly (string | number)[] } | undefined,
	offset: number,
): Promise<ViewerResourcesKeysetRow[]> {
	return readKeysetWindow(
		knex,
		'viewer_resources',
		(qb) => applyViewerResourcesFilters(qb, options),
		['resource_id'],
		spec,
		orderDirection,
		limit,
		keyset,
		offset,
	);
}

/**
 * Builds the final {@link CursorPaginatedResourceList}: joins the resolved
 * `resource_id` window back to full resource metadata, and mints
 * `nextCursor`/`prevCursor` from the window's boundary rows.
 * @param knex - The archive's Knex instance.
 * @param window - Up to `limit + 1` rows from {@link readViewerResourcesWindow},
 *   already trimmed to at most `limit` and in FINAL display order.
 * @param context - Shared cursor/response context.
 * @param context.spec - The resolved sort spec.
 * @param context.filterKey - See `buildViewerResourcesFilterKey`.
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
	window: ViewerResourcesKeysetRow[],
	context: {
		spec: ViewerResourcesSortSpec;
		filterKey: string;
		sortBy: 'url' | 'status';
		sortOrder: 'asc' | 'desc';
		total: number;
		limit: number;
		offset: number;
		hasMoreAfter: boolean;
		hasMoreBefore: boolean;
	},
): Promise<CursorPaginatedResourceList> {
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
	const items = await joinViewerResourceIdsToListItems(
		knex,
		window.map((row) => row.resource_id),
	);
	const lastRow = window.at(-1);
	const firstRow = window[0];
	const nextCursor =
		hasMoreAfter && lastRow
			? encodeViewerResourcesCursor({
					v: VIEWER_READ_MODEL_SCHEMA_VERSION,
					filterKey,
					sortBy,
					sortOrder,
					values: extractSortValues(spec, lastRow),
				})
			: null;
	const prevCursor =
		hasMoreBefore && firstRow
			? encodeViewerResourcesCursor({
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
 * Lists resources from `viewer_resources` — the read-model-backed,
 * cursor-paginated counterpart of `listResources` that powers
 * `/api/resources`'s fast path.
 *
 * Filter/sort resolution runs entirely against the narrow, indexed
 * `viewer_resources` table; the wide write-model `resources` table (plus
 * `viewer_resource_stats` for `referrerCount`) is joined only after the id
 * set is `limit`-bounded (see `joinViewerResourceIdsToListItems`). The
 * initial read (no `cursor`), the forward keyset read, the backward keyset
 * read, and the direct-`offset` read are four separate code paths — no
 * `(:cursor IS NULL OR …)`-style nullable predicate ties them together (same
 * structure as `listViewerPages`).
 *
 * `options.cursor` takes priority over `options.offset` when both are
 * supplied.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current (see
 *   `isViewerReadModelCurrent`) before calling this — it assumes
 *   `viewer_resources`/`viewer_resource_stats` exist and trusts their content.
 * @param options - Filter, sort, and pagination options.
 * @returns A cursor-paginated list of resource entries, response-shape-compatible
 *   with `listResources`'s `PaginatedResourceList` plus `nextCursor`/`prevCursor`.
 * @throws {Error} If `options.cursor` is malformed, stale, or was minted
 *   under a different filter/sort combination.
 * @example
 * const page1 = await listViewerResources(accessor, { limit: 100 });
 * const page2 = page1.nextCursor
 *   ? await listViewerResources(accessor, { limit: 100, cursor: page1.nextCursor })
 *   : null;
 */
export async function listViewerResources(
	accessor: ArchiveAccessor,
	options: ListViewerResourcesOptions = {},
): Promise<CursorPaginatedResourceList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const sortBy = options.sortBy ?? 'url';
	const sortOrder = options.sortOrder ?? 'asc';
	const spec = getViewerResourcesSortSpec(sortBy, sortOrder);
	const filterKey = buildViewerResourcesFilterKey(options);

	const total = await countViewerResourcesTotal(knex, options);

	if (options.cursor) {
		const decoded = decodeViewerResourcesCursor(options.cursor, {
			filterKey,
			sortBy,
			sortOrder,
			expectedValueCount: spec.columns.length,
		});
		if (options.direction === 'prev') {
			const oppositeDirection = spec.scanDirection === 'asc' ? 'desc' : 'asc';
			const fetched = await readViewerResourcesWindow(
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
		const fetched = await readViewerResourcesWindow(
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
	const fetched = await readViewerResourcesWindow(
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
