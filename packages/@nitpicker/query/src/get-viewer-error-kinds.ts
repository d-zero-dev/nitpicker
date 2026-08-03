import type {
	ErrorKindEntry,
	ErrorKindsResult,
	GetViewerErrorKindsOptions,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { applyEqualityOrInFilter } from './apply-equality-or-in-filter.js';
import { resolveErrorKindsSort } from './resolve-error-kinds-sort.js';

/**
 * Retrieves the crawl-failure breakdown from the precomputed
 * `viewer_error_kind_*` read-model tables — an indexed/filtered `SELECT`
 * plus a `COUNT(*)`, replacing `getErrorKinds`'s `page_errors`/
 * `crawl_errors`/`error.log` scan-and-classify pass on archives where the
 * read model is current. Filtering, sorting, and pagination all happen in
 * SQL, so the cost of any `options` combination is the same small query —
 * unlike the legacy path, which always re-scans and reclassifies before
 * filtering in memory.
 *
 * Callers are responsible for guarding with `isViewerReadModelCurrent`
 * first, the same convention `getViewerSummary` uses — this function does
 * not itself check staleness and throws if the meta row is missing.
 * @param accessor - The archive accessor to query.
 * @param options - Filter/sort/pagination options. Takes {@link
 *   GetViewerErrorKindsOptions}, not `GetErrorKindsOptions`: see that type's
 *   docs for why `kind`/`attribution` need a separate, array-capable type
 *   here.
 * @returns The error-kind breakdown, reconstructed from the read model.
 * @throws {Error} If `viewer_error_kind_meta` has no row (the caller
 *   failed to guard with `isViewerReadModelCurrent()`, or the read model is
 *   absent).
 * @example
 * if (await isViewerReadModelCurrent(accessor)) {
 *   return getViewerErrorKinds(accessor, { kind: 'dns', sortBy: 'count' });
 * }
 * return getErrorKinds(accessor, options); // legacy fallback
 */
export async function getViewerErrorKinds(
	accessor: ArchiveAccessor,
	options: GetViewerErrorKindsOptions = {},
): Promise<ErrorKindsResult> {
	const knex = accessor.getKnex();
	const meta = await knex('viewer_error_kind_meta').where('id', 1).first();
	if (!meta) {
		throw new Error(
			'getViewerErrorKinds: viewer_error_kind_meta row is missing — caller must guard ' +
				'with isViewerReadModelCurrent() before calling getViewerErrorKinds().',
		);
	}

	let query = knex('viewer_error_kind_entries');
	if (options.host) {
		query = query.where('host', options.host);
	}
	applyEqualityOrInFilter(query, 'kind', options.kind);
	applyEqualityOrInFilter(query, 'attribution', options.attribution);

	const totalRow = await query
		.clone()
		.count<{ count: string | number }[]>({ count: '*' });
	const total = Number(totalRow[0]?.count ?? 0);

	const { sortBy, sortOrder } = resolveErrorKindsSort(options);
	// host/kind tie-break every ordering so results are deterministic across
	// repeated reads regardless of which field the caller actually sorted
	// by. No separate `*_sort_key` columns are needed for this: `host`/`kind`
	// are never case-folded or otherwise transformed anywhere in this
	// codebase, so ordering on them directly is exactly as correct.
	const rows: {
		host: string;
		kind: ErrorKindEntry['kind'];
		attribution: ErrorKindEntry['attribution'];
		count: number;
		sample_urls_json: string;
		overflowed_count: number;
	}[] = await query
		.orderBy([
			{ column: sortBy, order: sortOrder },
			{ column: 'host' },
			{ column: 'kind' },
		])
		.limit(options.limit ?? -1)
		.offset(options.offset ?? 0)
		.select(
			'host',
			'kind',
			'attribution',
			'count',
			'sample_urls_json',
			'overflowed_count',
		);

	const items: ErrorKindEntry[] = rows.map((row) => ({
		host: row.host,
		kind: row.kind,
		attribution: row.attribution,
		count: Number(row.count),
		sampleUrls: JSON.parse(row.sample_urls_json) as string[],
		overflowedCount: Number(row.overflowed_count),
	}));

	return {
		items,
		total,
		facets: {
			totalRecords: Number(meta.total_records),
			channelSource: meta.channel_source as ErrorKindsResult['facets']['channelSource'],
		},
	};
}
