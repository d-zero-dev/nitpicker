import type { HeaderChecksKeysetRow, HeaderChecksSortSpec } from './types.js';

import { extractKeysetSortValues } from '../viewer-cursor-kit/extract-keyset-sort-values.js';

/**
 * Extracts a row's keyset tuple values in `spec.columns` order — the values
 * bound into a cursor's comparison tuple. Thin wrapper over the shared
 * {@link extractKeysetSortValues}.
 * @param spec - The sort spec whose columns to read.
 * @param row - The source row (must carry every column in `spec.columns`).
 * @returns The tuple values, in `spec.columns` order.
 */
export function extractHeaderChecksSortValues(
	spec: HeaderChecksSortSpec,
	row: HeaderChecksKeysetRow,
): (string | number)[] {
	return extractKeysetSortValues(spec, row);
}
