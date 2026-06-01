import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/** The URL-backed filter state and an updater. */
export interface UrlFilter {
	/** The current URL search params. */
	params: URLSearchParams;
	/** Sets (or, when value is empty, deletes) a single search param. */
	update: (key: string, value: string) => void;
}

/**
 * Reads and updates filter/sort state stored in the URL query string.
 *
 * Centralizes the "set or delete one param" logic shared by the list views, so
 * filter state survives reloads and is sharable via the URL.
 * @returns The current params and a single-key updater.
 */
export function useUrlFilter(): UrlFilter {
	const [params, setParams] = useSearchParams();
	const update = useCallback(
		(key: string, value: string) => {
			const next = new URLSearchParams(params);
			if (value) {
				next.set(key, value);
			} else {
				next.delete(key);
			}
			setParams(next);
		},
		[params, setParams],
	);
	return { params, update };
}
