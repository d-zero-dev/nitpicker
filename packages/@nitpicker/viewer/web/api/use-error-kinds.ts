import type { ErrorKind, ErrorKindEntry, ErrorKindFacets } from '@nitpicker/query';

import { usePagedQuery } from './use-paged-query.js';

/** Options for {@link useErrorKinds}. */
export interface UseErrorKindsOptions {
	/** Exact host to filter to — used by the detail pane's host×kind lookup. */
	host?: string;
	/** Exact kind to filter to — the list's kind column filter, or half of the detail pane's lookup key. */
	kind?: ErrorKind;
	/** Field to sort results by. */
	sortBy?: 'host' | 'kind' | 'count';
	/** Sort direction. */
	sortOrder?: 'asc' | 'desc';
	/** Maximum rows to return. Omit to return every matching row. */
	limit?: number;
	/** Rows to skip from the start. */
	offset?: number;
}

/**
 * Fetches crawl failures classified by cause (DNS, connection, TLS, timeout, …),
 * one row per host×kind pair.
 * @param options - Filter, sort, and pagination options.
 * @returns The TanStack Query result for the error-kinds aggregation.
 */
export function useErrorKinds(options: UseErrorKindsOptions = {}) {
	return usePagedQuery<ErrorKindEntry, ErrorKindFacets>(
		'/api/error-kinds',
		{ ...options },
		['error-kinds', options],
	);
}
