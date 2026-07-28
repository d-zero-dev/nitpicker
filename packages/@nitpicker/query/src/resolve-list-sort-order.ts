import type { SortOrder } from './types.js';

/**
 * Normalizes a caller-supplied sort direction, falling back to `fallback`
 * when the value is neither `'asc'` nor `'desc'`.
 * @param sortOrder - The requested sort direction.
 * @param fallback - The sort direction to use when `sortOrder` is absent.
 * @returns A supported sort direction.
 * @example
 * const sortOrder = resolveListSortOrder('desc', 'asc'); // 'desc'
 */
export function resolveListSortOrder(
	sortOrder: SortOrder | undefined,
	fallback: SortOrder,
): SortOrder {
	return sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : fallback;
}
