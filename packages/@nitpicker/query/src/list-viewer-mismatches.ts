import type {
	CursorPaginatedMismatchList,
	ListViewerMismatchesOptions,
	MismatchEntry,
} from './types.js';
import type {
	MismatchesKeysetRow,
	MismatchesSortSpec,
} from './viewer-mismatches-cursor/types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';
import type { Knex } from 'knex';

import { readKeysetWindow } from './viewer-cursor-kit/read-keyset-window.js';
import { buildMismatchesFilterKey } from './viewer-mismatches-cursor/build-mismatches-filter-key.js';
import { decodeMismatchesCursor } from './viewer-mismatches-cursor/decode-mismatches-cursor.js';
import { encodeMismatchesCursor } from './viewer-mismatches-cursor/encode-mismatches-cursor.js';
import { extractMismatchesSortValues } from './viewer-mismatches-cursor/extract-mismatches-sort-values.js';
import { getMismatchesSortSpec } from './viewer-mismatches-cursor/get-mismatches-sort-spec.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model/viewer-read-model-schema-version.js';

/** One `viewer_mismatches` window row, plus its display-only columns. */
interface MismatchWindowRow extends MismatchesKeysetRow {
	/** See `viewer_mismatches.actual`. */
	actual: string | null;
	/** See `viewer_mismatches.expected`. */
	expected: string | null;
}

/**
 * Constrains a `viewer_mismatches` query builder to one `type` — the only
 * filter `listViewerMismatches` supports, and required (see
 * `ListViewerMismatchesOptions.type`'s docs).
 * @param qb - The query builder to constrain.
 * @param options - The caller's options.
 */
function applyMismatchesFilters(
	qb: Knex.QueryBuilder,
	options: ListViewerMismatchesOptions,
): void {
	qb.where('type', options.type);
}

/**
 * Counts the total `viewer_mismatches` rows matching the caller's `type`.
 * @param knex - The archive's Knex instance.
 * @param options - The caller's options.
 * @returns The total matching row count.
 */
async function countMismatchesTotal(
	knex: Knex,
	options: ListViewerMismatchesOptions,
): Promise<number> {
	const qb = knex('viewer_mismatches');
	applyMismatchesFilters(qb, options);
	const result = await qb.count<{ count: string }[]>({ count: '*' });
	return Number(result[0]?.count ?? 0);
}

/**
 * Runs one `viewer_mismatches` read via the shared {@link readKeysetWindow}.
 * No join follows: `url_sort_key` is already the exact display URL (copied
 * from `pages.url` verbatim at build time), the same no-join shape
 * `listViewerHeaderChecks`/`listViewerBrokenLinks` use.
 * @param knex - The archive's Knex instance.
 * @param options - The caller's options.
 * @param spec - The resolved sort spec (columns to select/order by).
 * @param orderDirection - The physical scan direction for this read.
 * @param limit - The page size (the read fetches `limit + 1` rows).
 * @param keyset - The keyset predicate to apply, or `undefined` for an
 *   unconstrained (initial / offset) read.
 * @param offset - Row offset for a direct `OFFSET` read (page-number jumps).
 *   Ignored when `keyset` is supplied.
 * @returns Up to `limit + 1` rows.
 */
async function readMismatchesWindow(
	knex: Knex,
	options: ListViewerMismatchesOptions,
	spec: MismatchesSortSpec,
	orderDirection: 'asc' | 'desc',
	limit: number,
	keyset: { operator: '>' | '<'; values: readonly (string | number)[] } | undefined,
	offset: number,
): Promise<MismatchWindowRow[]> {
	return readKeysetWindow(
		knex,
		'viewer_mismatches',
		(qb) => applyMismatchesFilters(qb, options),
		['actual', 'expected'],
		spec,
		orderDirection,
		limit,
		keyset,
		offset,
	);
}

/**
 * Maps one raw window row to the public `MismatchEntry` shape.
 * @param row - One row from {@link readMismatchesWindow}.
 * @param type - The mismatch type this window was read for.
 * @returns The corresponding `MismatchEntry`.
 */
function toMismatchEntry(
	row: MismatchWindowRow,
	type: ListViewerMismatchesOptions['type'],
): MismatchEntry {
	return { url: row.url_sort_key, type, actual: row.actual, expected: row.expected };
}

/**
 * Lists metadata mismatches from `viewer_mismatches` — the read-model-backed,
 * cursor-paginated counterpart of `findMismatches` that powers
 * `/api/mismatches`'s fast path (issue #115).
 *
 * Filter/sort resolution runs entirely against the narrow, indexed
 * `viewer_mismatches` table. The initial read (no `cursor`), the forward
 * keyset read, the backward keyset read, and the direct-`offset` read are
 * four separate code paths, mirroring `listViewerHeaderChecks`.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current (see
 *   `isViewerReadModelCurrent`) before calling this.
 * @param options - Filter, sort, and pagination options. `type` is required.
 * @returns A cursor-paginated list of mismatch entries.
 * @throws {Error} If `options.cursor` is malformed, stale, or was minted
 *   under a different `type`/sort combination.
 * @example
 * const page1 = await listViewerMismatches(accessor, { type: 'canonical' });
 * const page2 = page1.nextCursor
 *   ? await listViewerMismatches(accessor, { type: 'canonical', cursor: page1.nextCursor })
 *   : null;
 */
export async function listViewerMismatches(
	accessor: ArchiveAccessor,
	options: ListViewerMismatchesOptions,
): Promise<CursorPaginatedMismatchList> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const sortOrder = options.sortOrder ?? 'asc';
	const spec = getMismatchesSortSpec(sortOrder);
	const filterKey = buildMismatchesFilterKey(options);

	const total = await countMismatchesTotal(knex, options);

	/**
	 * Builds the final result from a `limit`-or-fewer window, already in
	 * final display order.
	 * @param window - The trimmed row window.
	 * @param hasMoreAfter - Whether a subsequent page exists.
	 * @param hasMoreBefore - Whether a preceding page exists.
	 * @returns The full paginated result.
	 */
	function buildResult(
		window: MismatchWindowRow[],
		hasMoreAfter: boolean,
		hasMoreBefore: boolean,
	): CursorPaginatedMismatchList {
		const items = window.map((row) => toMismatchEntry(row, options.type));
		const lastRow = window.at(-1);
		const firstRow = window[0];
		const nextCursor =
			hasMoreAfter && lastRow
				? encodeMismatchesCursor({
						v: VIEWER_READ_MODEL_SCHEMA_VERSION,
						filterKey,
						sortBy: 'url',
						sortOrder,
						values: extractMismatchesSortValues(spec, lastRow),
					})
				: null;
		const prevCursor =
			hasMoreBefore && firstRow
				? encodeMismatchesCursor({
						v: VIEWER_READ_MODEL_SCHEMA_VERSION,
						filterKey,
						sortBy: 'url',
						sortOrder,
						values: extractMismatchesSortValues(spec, firstRow),
					})
				: null;
		return { items, total, offset: options.offset ?? 0, limit, nextCursor, prevCursor };
	}

	if (options.cursor) {
		const decoded = decodeMismatchesCursor(options.cursor, { filterKey, sortOrder });
		if (options.direction === 'prev') {
			const oppositeDirection = spec.scanDirection === 'asc' ? 'desc' : 'asc';
			const fetched = await readMismatchesWindow(
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
			return buildResult(window, true, hasMoreBefore);
		}
		const fetched = await readMismatchesWindow(
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
		return buildResult(window, hasMoreAfter, true);
	}

	const offset = options.offset ?? 0;
	const fetched = await readMismatchesWindow(
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
	return buildResult(window, hasMoreAfter, offset > 0);
}
