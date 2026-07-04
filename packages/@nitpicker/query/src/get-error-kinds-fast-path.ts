import type { ErrorKindsResult } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { getErrorKinds } from './get-error-kinds.js';
import { getViewerErrorKinds } from './get-viewer-error-kinds.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches to `getViewerErrorKinds` (the `viewer_error_kind_*` read-model
 * fast path, issue #118) when current, else `getErrorKinds` (the legacy
 * live classify-and-aggregate pass).
 *
 * Mirrors `getSummaryFastPath`'s two-way dispatch: `/api/error-kinds` has no
 * request parameters that could force a legacy fallback, so the only
 * question is whether the read model is current.
 * @param accessor - The archive accessor to query.
 * @returns The error-kind breakdown, from whichever backend is currently valid.
 * @example
 * // Callers never need to check isViewerReadModelCurrent themselves:
 * const errorKinds = await getErrorKindsFastPath(accessor);
 */
export async function getErrorKindsFastPath(
	accessor: ArchiveAccessor,
): Promise<ErrorKindsResult> {
	return (await isViewerReadModelCurrent(accessor))
		? getViewerErrorKinds(accessor)
		: getErrorKinds(accessor);
}
