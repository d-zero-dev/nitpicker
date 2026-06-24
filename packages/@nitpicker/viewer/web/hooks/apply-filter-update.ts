import { PAGE_QUERY_KEY } from './use-current-page.js';

/**
 * The pure transformation that {@link import('./use-url-filter.js').useUrlFilter}
 * applies inside its `setSearchParams` functional updater. Extracted so the
 * behaviour (set vs delete, the implicit `?page=` reset) can be unit-tested
 * without a React Router context.
 *
 * Rules:
 *
 * - Truthy `value` → `set(key, value)`; empty/falsy → `delete(key)`.
 * - Any non-`page` key change also deletes `?page=` (filter / sort changes
 *   invalidate row-N positions).
 * - Setting `?page=` itself does **not** trigger the page reset (that's the
 *   one key allowed to coexist with itself).
 *
 * No-op detection lives in the hook, not here — the caller checks
 * `currentValue === targetValue` and skips invoking the updater entirely.
 * @param prev - The current URLSearchParams.
 * @param key - The query parameter to set or delete.
 * @param value - The new value (truthy → set, falsy → delete).
 * @returns A new URLSearchParams reflecting the update.
 */
export function applyFilterUpdate(
	prev: URLSearchParams,
	key: string,
	value: string,
): URLSearchParams {
	const next = new URLSearchParams(prev);
	if (value) {
		next.set(key, value);
	} else {
		next.delete(key);
	}
	if (key !== PAGE_QUERY_KEY) {
		next.delete(PAGE_QUERY_KEY);
	}
	return next;
}
