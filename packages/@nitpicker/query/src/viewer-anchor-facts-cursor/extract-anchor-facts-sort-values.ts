import type { AnchorFactsKeysetRow, AnchorFactsSortSpec } from './types.js';

/**
 * Extracts a row's keyset tuple values in `spec.columns` order — the values
 * bound into a cursor's comparison tuple.
 * @param spec - The sort spec whose columns to read.
 * @param row - The source row (must carry every column in `spec.columns`).
 * @returns The tuple values, in `spec.columns` order.
 */
export function extractAnchorFactsSortValues(
	spec: AnchorFactsSortSpec,
	row: AnchorFactsKeysetRow,
): (string | number)[] {
	return spec.columns.map((column) => row[column]);
}
