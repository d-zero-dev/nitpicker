import { PAGE_QUERY_KEY } from './use-current-page.js';

/**
 * The pure transformation behind
 * {@link import('./use-url-filter.js').UrlFilter.updateMany}: applies several
 * query-parameter updates in one pass. A link (`<Link to={{ search }}>`) uses it
 * to compute the URL a filter change would produce with exactly the rules the
 * in-place updater uses, and it is a pure function so the rules are testable
 * without a React Router context.
 *
 * Rules, per `[key, value]`:
 *
 * - An array value is written as repeated keys; empty items are dropped.
 * - An empty value deletes the key.
 * - A key whose values already equal the current ones is skipped.
 * - If any non-`page` key changed, `?page=` is deleted (row-N positions are
 *   invalid after a filter/sort change).
 *
 * When nothing changed, `prev` itself is returned (not a copy) so the caller
 * can skip the navigation.
 * @param prev - The current URLSearchParams.
 * @param updates - The `[key, value]` pairs to apply.
 * @returns The updated URLSearchParams, or `prev` when nothing changed.
 * @example
 * ```ts
 * const next = applyFilterUpdates(new URLSearchParams('page=3'), [['host', 'a.example']]);
 * next.toString(); // 'host=a.example'
 * ```
 */
export function applyFilterUpdates(
	prev: URLSearchParams,
	updates: ReadonlyArray<readonly [key: string, value: string | readonly string[]]>,
): URLSearchParams {
	const next = new URLSearchParams(prev);
	let changed = false;
	let shouldResetPage = false;
	for (const [key, value] of updates) {
		const values = Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
		const currentValues = next.getAll(key);
		if (
			currentValues.length === values.length &&
			currentValues.every((current, index) => current === values[index])
		) {
			continue;
		}
		next.delete(key);
		for (const item of values) {
			next.append(key, item);
		}
		changed = true;
		if (key !== PAGE_QUERY_KEY) shouldResetPage = true;
	}
	if (!changed) return prev;
	if (shouldResetPage) next.delete(PAGE_QUERY_KEY);
	return next;
}
