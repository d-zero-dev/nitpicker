import type {
	CursorPaginatedUnusedResourceList,
	ListViewerUnusedResourcesOptions,
} from './types.js';
import type {
	ViewerUnusedResourcesKeysetRow,
	ViewerUnusedResourcesSortSpec,
} from './viewer-unused-resources-cursor/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { applyViewerUnusedResourcesFilters } from './apply-viewer-unused-resources-filters.js';
import { countViewerUnusedResourcesTotal } from './count-viewer-unused-resources-total.js';
import { joinViewerUnusedResourceIdsToListItems } from './join-viewer-unused-resource-ids-to-list-items.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model/viewer-read-model-schema-version.js';
import { buildViewerUnusedResourcesFilterKey } from './viewer-unused-resources-cursor/build-viewer-unused-resources-filter-key.js';
import { decodeViewerUnusedResourcesCursor } from './viewer-unused-resources-cursor/decode-viewer-unused-resources-cursor.js';
import { encodeViewerUnusedResourcesCursor } from './viewer-unused-resources-cursor/encode-viewer-unused-resources-cursor.js';
import { extractSortValues } from './viewer-unused-resources-cursor/extract-sort-values.js';
import { getViewerUnusedResourcesSortSpec } from './viewer-unused-resources-cursor/get-viewer-unused-resources-sort-spec.js';

/**
 * Adds a keyset comparison tuple as a `WHERE` predicate — `(col1, col2, …)
 * {>|<} (?, ?, …)` — using SQLite's row-value comparison. Column names come
 * from the fixed {@link ViewerUnusedResourcesSortSpec} column set, never from
 * request input, so interpolating them into the SQL text (rather than
 * parameter binding, which only covers values) carries no injection risk.
 * @param qb - The query builder to constrain.
 * @param columns - The keyset tuple columns, in comparison order.
 * @param operator - `'>'` for a forward (ascending-tuple) seek, `'<'` for a
 *   backward one.
 * @param values - The boundary row's tuple values, in `columns` order.
 */
function applyKeysetPredicate(
	qb: Knex.QueryBuilder,
	columns: readonly string[],
	operator: '>' | '<',
	values: readonly (string | number)[],
): void {
	const columnList = columns.join(', ');
	const placeholders = columns.map(() => '?').join(', ');
	qb.whereRaw(`(${columnList}) ${operator} (${placeholders})`, [...values]);
}

/**
 * Runs one `viewer_resources` id-resolution read (fixed `is_unused = 1`
 * base predicate): applies filters, an optional keyset predicate, an
 * `ORDER BY` in `orderDirection`, and `limit + 1` rows (the `+1` lets the
 * caller detect "is there another row past this page" without a second
 * query).
 * @param knex - The archive's Knex instance.
 * @param options - The caller's filter options.
 * @param spec - The resolved sort spec (columns to select/order by).
 * @param orderDirection - The physical scan direction for this read.
 * @param limit - The page size (the read fetches `limit + 1` rows).
 * @param keyset - The keyset predicate to apply, or `undefined` for an
 *   unconstrained (initial / offset) read.
 * @param keyset.operator - `'>'` or `'<'`, per {@link applyKeysetPredicate}.
 * @param keyset.values - The boundary row's tuple values.
 * @param offset - Row offset for a direct `OFFSET` read (page-number jumps).
 *   Ignored when `keyset` is supplied.
 * @returns Up to `limit + 1` rows carrying `resource_id` and every sort column.
 */
async function readViewerUnusedResourcesWindow(
	knex: Knex,
	options: ListViewerUnusedResourcesOptions,
	spec: ViewerUnusedResourcesSortSpec,
	orderDirection: 'asc' | 'desc',
	limit: number,
	keyset: { operator: '>' | '<'; values: readonly (string | number)[] } | undefined,
	offset: number,
): Promise<ViewerUnusedResourcesKeysetRow[]> {
	const qb = knex('viewer_resources');
	applyViewerUnusedResourcesFilters(qb, options);
	if (keyset) {
		applyKeysetPredicate(qb, spec.columns, keyset.operator, keyset.values);
	}
	const selectColumns = [...new Set<string>(['resource_id', ...spec.columns])];
	let query = qb
		.select(selectColumns)
		.orderBy(spec.columns.map((column) => ({ column, order: orderDirection })))
		.limit(limit + 1);
	if (!keyset && offset > 0) {
		query = query.offset(offset);
	}
	return query;
}

/**
 * Builds the final {@link CursorPaginatedUnusedResourceList}: joins the
 * resolved `resource_id` window back to full resource metadata, and mints
 * `nextCursor`/`prevCursor` from the window's boundary rows.
 * @param knex - The archive's Knex instance.
 * @param window - Up to `limit + 1` rows from
 *   {@link readViewerUnusedResourcesWindow}, already trimmed to at most
 *   `limit` and in FINAL display order.
 * @param context - Shared cursor/response context.
 * @param context.spec - The resolved sort spec.
 * @param context.filterKey - See `buildViewerUnusedResourcesFilterKey`.
 * @param context.sortBy - The effective sort field.
 * @param context.sortOrder - The effective sort direction.
 * @param context.total - The total matching row count.
 * @param context.hasMoreAfter - Whether a subsequent page exists.
 * @param context.hasMoreBefore - Whether a preceding page exists.
 * @returns The full paginated result.
 */
async function buildCursorPaginatedResult(
	knex: Knex,
	window: ViewerUnusedResourcesKeysetRow[],
	context: {
		spec: ViewerUnusedResourcesSortSpec;
		filterKey: string;
		sortBy: 'url' | 'status' | 'source';
		sortOrder: 'asc' | 'desc';
		total: number;
		hasMoreAfter: boolean;
		hasMoreBefore: boolean;
	},
): Promise<CursorPaginatedUnusedResourceList> {
	const { spec, filterKey, sortBy, sortOrder, total, hasMoreAfter, hasMoreBefore } =
		context;
	const items = await joinViewerUnusedResourceIdsToListItems(
		knex,
		window.map((row) => row.resource_id),
	);
	const lastRow = window.at(-1);
	const firstRow = window[0];
	const nextCursor =
		hasMoreAfter && lastRow
			? encodeViewerUnusedResourcesCursor({
					v: VIEWER_READ_MODEL_SCHEMA_VERSION,
					filterKey,
					sortBy,
					sortOrder,
					values: extractSortValues(spec, lastRow),
				})
			: null;
	const prevCursor =
		hasMoreBefore && firstRow
			? encodeViewerUnusedResourcesCursor({
					v: VIEWER_READ_MODEL_SCHEMA_VERSION,
					filterKey,
					sortBy,
					sortOrder,
					values: extractSortValues(spec, firstRow),
				})
			: null;
	return { items, total, nextCursor, prevCursor };
}

/**
 * Lists unused resources from `viewer_resources` — the read-model-backed,
 * cursor-paginated counterpart of `listUnusedResources` that powers
 * `/api/unused-resources`'s fast path.
 *
 * Filter/sort resolution runs entirely against the narrow, indexed,
 * pre-filtered (`is_unused = 1`) `viewer_resources` table — no request-time
 * anti-join over `resources`/`resources-referrers`. The wide write-model
 * `resources` table is joined only after the id set is `limit`-bounded (see
 * `joinViewerUnusedResourceIdsToListItems`). The initial read (no `cursor`),
 * the forward keyset read, the backward keyset read, and the direct-`offset`
 * read are four separate code paths (same structure as `listViewerPages`).
 *
 * `options.cursor` takes priority over `options.offset` when both are
 * supplied.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current (see
 *   `isViewerReadModelCurrent`) before calling this — it assumes
 *   `viewer_resources` exists and trusts its content.
 * @param options - Filter, sort, and pagination options.
 * @returns A cursor-paginated list of unused-resource entries,
 *   response-shape-compatible with `listUnusedResources`'s
 *   `PaginatedUnusedResourceList` plus `nextCursor`/`prevCursor`.
 * @throws {Error} If `options.cursor` is malformed, stale, or was minted
 *   under a different filter/sort combination.
 * @example
 * const page1 = await listViewerUnusedResources(accessor, { limit: 100 });
 * const page2 = page1.nextCursor
 *   ? await listViewerUnusedResources(accessor, { limit: 100, cursor: page1.nextCursor })
 *   : null;
 */
export async function listViewerUnusedResources(
	accessor: ArchiveAccessor,
	options: ListViewerUnusedResourcesOptions = {},
): Promise<CursorPaginatedUnusedResourceList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const sortBy = options.sortBy ?? 'url';
	const sortOrder = options.sortOrder ?? 'asc';
	const spec = getViewerUnusedResourcesSortSpec(sortBy, sortOrder);
	const filterKey = buildViewerUnusedResourcesFilterKey(options);

	const total = await countViewerUnusedResourcesTotal(knex, options);

	if (options.cursor) {
		const decoded = decodeViewerUnusedResourcesCursor(options.cursor, {
			filterKey,
			sortBy,
			sortOrder,
			expectedValueCount: spec.columns.length,
		});
		if (options.direction === 'prev') {
			const oppositeDirection = spec.scanDirection === 'asc' ? 'desc' : 'asc';
			const fetched = await readViewerUnusedResourcesWindow(
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
				hasMoreAfter: true,
				hasMoreBefore,
			});
		}
		const fetched = await readViewerUnusedResourcesWindow(
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
			hasMoreAfter,
			hasMoreBefore: true,
		});
	}

	const offset = options.offset ?? 0;
	const fetched = await readViewerUnusedResourcesWindow(
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
		hasMoreAfter,
		hasMoreBefore: offset > 0,
	});
}
