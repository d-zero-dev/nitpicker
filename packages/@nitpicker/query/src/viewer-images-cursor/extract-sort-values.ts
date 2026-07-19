import type { ViewerImagesKeysetRow, ViewerImagesSortSpec } from './types.js';

import { extractKeysetSortValues } from '../viewer-cursor-kit/extract-keyset-sort-values.js';

/**
 * Extracts a row's keyset tuple values in `spec.columns` order — the values
 * bound into a `/api/images` cursor's comparison tuple. Thin wrapper over
 * the shared {@link extractKeysetSortValues}.
 * @param spec - The sort spec whose columns to read.
 * @param row - The source row (must carry every column in `spec.columns`).
 * @returns The tuple values, in `spec.columns` order.
 */
export function extractSortValues(
	spec: ViewerImagesSortSpec,
	row: ViewerImagesKeysetRow,
): (string | number)[] {
	return extractKeysetSortValues(spec, row);
}
