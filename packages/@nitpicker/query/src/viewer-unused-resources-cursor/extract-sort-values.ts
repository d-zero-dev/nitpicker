import type {
	ViewerUnusedResourcesKeysetRow,
	ViewerUnusedResourcesSortSpec,
} from './types.js';

/**
 * Extracts a row's keyset tuple values in `spec.columns` order — the values
 * bound into a `/api/unused-resources` cursor's comparison tuple.
 * @param spec - The sort spec whose columns to read.
 * @param row - The source row (must carry every column in `spec.columns`).
 * @returns The tuple values, in `spec.columns` order.
 */
export function extractSortValues(
	spec: ViewerUnusedResourcesSortSpec,
	row: ViewerUnusedResourcesKeysetRow,
): (string | number)[] {
	return spec.columns.map((column) => row[column]);
}
