import type {
	ErrorKind,
	ErrorKindEntry,
	ErrorKindFacets,
	FailureAttribution,
} from '@nitpicker/query';

import { usePagedQuery } from './use-paged-query.js';

/** Options for {@link useErrorKinds}. */
export interface UseErrorKindsOptions {
	/** Exact host to filter to — used by the detail pane's host×kind×attribution lookup. */
	host?: string;
	/** Kind(s) to filter to (OR'd) — the list's kind column filter, or one third of the detail pane's exact lookup key. */
	kind?: ErrorKind | readonly ErrorKind[];
	/** Attribution(s) to filter to (OR'd) — the list's attribution column filter, or one third of the detail pane's exact lookup key. */
	attribution?: FailureAttribution | readonly FailureAttribution[];
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
