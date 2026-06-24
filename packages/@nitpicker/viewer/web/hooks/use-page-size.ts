import type { PageSize } from '../types.js';

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { parsePageSize } from './parse-page-size.js';
import { PAGE_QUERY_KEY } from './use-current-page.js';

/** The URL query key that encodes the current page size. */
export const PAGE_SIZE_QUERY_KEY = 'pageSize';

/** localStorage key for the persisted page-size *hint*. */
const STORAGE_KEY = 'nitpicker-page-size';

/**
 * Default page size when the URL has no `?pageSize=` and localStorage has
 * no remembered preference yet. Matches the historical `PAGE_SIZE` constant
 * (virtual-mode infinite query) so the two modes feel symmetric.
 */
const DEFAULT_PAGE_SIZE: PageSize = 100;

/** Allowed page-size values in the MPA pager's `<select>`. */
export const PAGE_SIZE_OPTIONS: readonly PageSize[] = [50, 100, 200];

/**
 * Reads the persisted page-size hint from localStorage, falling back to the
 * default. Used as the secondary source when the URL omits `?pageSize=`
 * (typical: returning user opens `/pages` directly, no query string).
 *
 * Wrapped in try/catch because sandboxed / private-browsing contexts throw
 * `SecurityError` on plain `localStorage.getItem`. Failure → use default.
 * @returns The hinted page size, or the default.
 */
function readPageSizeHint(): PageSize {
	try {
		const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
		if (saved === null || saved === undefined) {
			return DEFAULT_PAGE_SIZE;
		}
		return parsePageSize(Number(saved)) ?? DEFAULT_PAGE_SIZE;
	} catch {
		return DEFAULT_PAGE_SIZE;
	}
}

/** The shape returned by {@link usePageSize}. */
export interface UsePageSizeResult {
	/** The currently effective page size. */
	pageSize: PageSize;
	/**
	 * Sets the page size — writes `?pageSize=N` to the URL **and** mirrors
	 * the value to localStorage. Also clears `?page=` (the old page number is
	 * not coherent under a new window size) and uses `replace: true` so the
	 * resize action does not pollute history.
	 */
	setPageSize: (next: PageSize) => void;
}

/**
 * Reads and writes the user's MPA page-size preference.
 *
 * **The URL (`?pageSize=N`) is the source of truth** so a shared link
 * carries the page-size context — without this, `?page=5` means
 * "row 200–249" for one operator and "row 400–499" for another with a
 * different localStorage hint, defeating deep-linking. localStorage is
 * retained only as a hint for new tabs and bookmark-less navigation
 * (first-visit fallback); changing the size persists to both surfaces.
 *
 * The default size is **not** written to the URL (`?pageSize=100` is
 * omitted) to keep the canonical first-page URL clean — same convention as
 * `?page=1` being omitted in {@link import('./apply-set-page.js').applySetPage}.
 * Invalid `?pageSize=` values (hand-edited, future incompatibility) collapse
 * to the localStorage hint or the default via {@link parsePageSize}.
 * @returns The current page size plus a setter.
 */
export function usePageSize(): UsePageSizeResult {
	const [params, setParams] = useSearchParams();
	const pageSize = useMemo<PageSize>(() => {
		const fromUrl = parsePageSize(Number(params.get(PAGE_SIZE_QUERY_KEY)));
		if (fromUrl !== null) {
			return fromUrl;
		}
		return readPageSizeHint();
	}, [params]);

	const setPageSize = useCallback(
		(next: PageSize) => {
			const validated = parsePageSize(next);
			if (validated === null) {
				return;
			}
			setParams(
				(prev) => {
					const nextParams = new URLSearchParams(prev);
					if (validated === DEFAULT_PAGE_SIZE) {
						// Canonical-URL convention: the default size does not appear
						// in the URL. A returning user with this preference in
						// localStorage gets it via the hint path.
						nextParams.delete(PAGE_SIZE_QUERY_KEY);
					} else {
						nextParams.set(PAGE_SIZE_QUERY_KEY, String(validated));
					}
					// The old `?page=N` is row-coherent only under the previous
					// window size; a fresh size restarts at page 1.
					nextParams.delete(PAGE_QUERY_KEY);
					return nextParams;
				},
				{ replace: true },
			);
			try {
				globalThis.localStorage?.setItem(STORAGE_KEY, String(validated));
			} catch {
				// Ignore — localStorage is a hint, not a source of truth.
			}
		},
		[setParams],
	);
	return { pageSize, setPageSize };
}
