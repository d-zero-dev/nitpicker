import type { ErrorKindInsertRows } from './types.js';
import type { ErrorKindsResult } from '../types.js';

/**
 * Normalises an already-classified, unfiltered {@link ErrorKindsResult}
 * (produced by `getErrorKinds(accessor)` with no options — the "whole
 * archive" contract) into flat row arrays for the `viewer_error_kind_*`
 * tables. Performs no classification itself — `classifyErrorKind` runs
 * exactly once, inside `getErrorKinds`, so the read-model build and the
 * legacy live path can never disagree on how a message classifies (see
 * `create-viewer-read-model-tables.ts`'s "don't duplicate classification
 * logic" note for issue #118).
 * @param result - The unfiltered result of `getErrorKinds(accessor)`.
 * @returns Insert-ready rows for `viewer_error_kind_entries`, plus the
 *   single `viewer_error_kind_meta` row.
 */
export function computeErrorKindInsertRows(
	result: ErrorKindsResult,
): ErrorKindInsertRows {
	const entries: ErrorKindInsertRows['entries'] = result.items.map((item) => ({
		host: item.host,
		kind: item.kind,
		attribution: item.attribution,
		count: item.count,
		sample_urls_json: JSON.stringify(item.sampleUrls),
		overflowed_count: item.overflowedCount,
	}));

	return {
		entries,
		meta: {
			total_records: result.facets.totalRecords,
			channel_source: result.facets.channelSource,
		},
	};
}
