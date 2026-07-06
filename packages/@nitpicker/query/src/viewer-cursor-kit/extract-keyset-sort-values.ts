import type { KeysetRow, KeysetSortSpec } from './types.js';

/**
 * Extracts a row's keyset tuple values in `spec.columns` order — the values
 * bound into a cursor's comparison tuple. Shared by every `viewer_*` table's
 * keyset-cursor module.
 * @param spec - The sort spec whose columns to read.
 * @param row - The source row (must carry every column in `spec.columns`).
 * @returns The tuple values, in `spec.columns` order.
 */
export function extractKeysetSortValues<Column extends string>(
	spec: KeysetSortSpec<Column>,
	row: KeysetRow<Column>,
): (string | number)[] {
	return spec.columns.map((column) => row[column]);
}
