import type { MismatchEntry } from '@nitpicker/query';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from './api-client.js';

/** Type of metadata mismatch to check. */
export type MismatchType = 'canonical' | 'og:title' | 'og:description';

/**
 * Fetches metadata mismatches of the given type.
 * @param type - The mismatch type.
 * @returns The TanStack Query result for the mismatches.
 */
export function useMismatches(type: MismatchType) {
	return useQuery({
		queryKey: ['mismatches', type],
		queryFn: () => apiGet<MismatchEntry[]>('/api/mismatches', { type }),
	});
}
