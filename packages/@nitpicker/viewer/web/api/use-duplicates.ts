import type { DuplicateEntry } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/** Field to check for duplicate values. */
export type DuplicateField = 'title' | 'description';

/**
 * Fetches pages sharing duplicate title or description values.
 * @param field - The metadata field to check.
 * @returns The TanStack Query result for the duplicate groups.
 */
export function useDuplicates(field: DuplicateField) {
	return useQuery({
		queryKey: ['duplicates', field],
		queryFn: () => apiGet<DuplicateEntry[]>('/api/duplicates', { field }),
	});
}
