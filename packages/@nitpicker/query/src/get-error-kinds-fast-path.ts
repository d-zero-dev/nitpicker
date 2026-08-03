import type { ErrorKindsResult, GetErrorKindsOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { getErrorKinds } from './get-error-kinds.js';
import { getViewerErrorKinds } from './get-viewer-error-kinds.js';
import { isViewerReadModelCurrent } from './viewer-read-model/is-viewer-read-model-current.js';

/**
 * Dispatches to `getViewerErrorKinds` (the `viewer_error_kind_*` read-model
 * fast path, issue #118) when current, else `getErrorKinds` (the live
 * live classify-and-aggregate pass). `options` passes through unchanged to
 * whichever backend answers — both implement the same filter/sort/pagination
 * contract, so the choice is purely "is the read model current or not".
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options.
 * @returns The error-kind breakdown, from whichever backend is currently valid.
 * @example
 * // Callers never need to check isViewerReadModelCurrent themselves:
 * const errorKinds = await getErrorKindsFastPath(accessor, { kind: 'dns' });
 */
export async function getErrorKindsFastPath(
	accessor: ArchiveAccessor,
	options: GetErrorKindsOptions = {},
): Promise<ErrorKindsResult> {
	return (await isViewerReadModelCurrent(accessor))
		? getViewerErrorKinds(accessor, options)
		: getErrorKinds(accessor, options);
}
