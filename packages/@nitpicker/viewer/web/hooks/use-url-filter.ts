import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

import { applyFilterUpdate } from './apply-filter-update.js';

/** Options for {@link UrlFilter.update}. */
export interface UrlFilterUpdateOptions {
	/**
	 * Replace the current history entry instead of pushing a new one. Use
	 * when the change is an automatic URL correction (e.g. rewriting a
	 * bookmarked `?type=orphaned` to `?type=broken`) rather than a user
	 * action — otherwise the back button takes the user to a URL state the
	 * UI just spent a render coercing away from.
	 */
	replace?: boolean;
}

/** The URL-backed filter state and an updater. */
export interface UrlFilter {
	/** The current URL search params. */
	params: URLSearchParams;
	/**
	 * Sets (or, when value is empty, deletes) a single search param. As a
	 * side effect, any non-`page` update clears the `?page=` cursor.
	 */
	update: (key: string, value: string, options?: UrlFilterUpdateOptions) => void;
}

/**
 * Reads and updates filter/sort state stored in the URL query string.
 *
 * Centralizes the "set or delete one param" logic shared by the list views, so
 * filter state survives reloads and is sharable via the URL.
 *
 * As a side effect, any **value-changing** non-`page` update clears the
 * `?page=` cursor — the old "row 4231" position no longer makes sense after
 * a filter/sort change. The "value-changing" qualifier matters: an `onBlur`
 * on an unchanged input must not silently kick the user back to page 1
 * (`update()` is a no-op when the new value equals the current value).
 *
 * Setting `?page=` itself goes through {@link
 * import('./use-current-page.js').useCurrentPage} and bypasses this hook.
 * The functional updater keeps `update`'s identity stable across renders so
 * dependent effects / memos do not re-run on every URL mutation.
 * @returns The current params and a single-key updater.
 */
export function useUrlFilter(): UrlFilter {
	const [params, setParams] = useSearchParams();
	const update = useCallback(
		(key: string, value: string, options?: UrlFilterUpdateOptions) => {
			const targetValue = value ?? '';
			setParams(
				(prev) => {
					const currentValue = prev.get(key) ?? '';
					if (currentValue === targetValue) {
						// No-op — avoid clearing `?page=` for an unchanged value
						// (e.g. `onBlur` from a focused-but-unedited filter input).
						// Returning `prev` keeps the URL string intact; react-router
						// short-circuits the navigation when the search params do
						// not change.
						return prev;
					}
					return applyFilterUpdate(prev, key, targetValue);
				},
				options?.replace === true ? { replace: true } : undefined,
			);
		},
		[setParams],
	);
	return { params, update };
}
