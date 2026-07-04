import type { ErrorKindInsertRows } from './types.js';
import type { ErrorKindsResult } from '../types.js';

/**
 * Normalises an already-classified {@link ErrorKindsResult} (produced by
 * `getErrorKinds`) into flat row arrays for the four `viewer_error_kind_*`
 * tables. Performs no classification itself — `classifyErrorKind` runs
 * exactly once, inside `getErrorKinds`, so the read-model build and the
 * legacy live path can never disagree on how a message classifies (see
 * `create-viewer-read-model-tables.ts`'s "don't duplicate classification
 * logic" note for issue #118).
 * @param result - The result of `getErrorKinds(accessor)`.
 * @returns Insert-ready rows for `viewer_error_kind_groups` / `_hosts` /
 *   `_samples`, plus the single `viewer_error_kind_meta` row.
 */
export function computeErrorKindInsertRows(
	result: ErrorKindsResult,
): ErrorKindInsertRows {
	const groups: ErrorKindInsertRows['groups'] = [];
	const hosts: ErrorKindInsertRows['hosts'] = [];
	const samples: ErrorKindInsertRows['samples'] = [];

	for (const group of result.groups) {
		groups.push({ kind: group.kind, count: group.count });
		for (const host of group.hosts) {
			hosts.push({ kind: group.kind, host: host.host, count: host.count });
		}
		for (const [rank, url] of group.sampleUrls.entries()) {
			samples.push({ kind: group.kind, rank, url });
		}
	}

	return {
		groups,
		hosts,
		samples,
		meta: { total: result.total, channel_source: result.channelSource },
	};
}
