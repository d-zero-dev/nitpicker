/**
 * Builds the normalized `filterKey` embedded in a cursor: every present key
 * is coalesced `undefined → null` and the object is `JSON.stringify`d in the
 * caller's own key order — two calls with the same effective filters
 * (regardless of `undefined` vs omitted) always produce the same string.
 * Shared by every `viewer_*` table's keyset-cursor module; callers pass
 * their own fixed-shape object literal (e.g.
 * `{ isExternal: options.isExternal, status: options.status }`) so the key
 * order — and therefore the exact string produced — is fixed per table
 * rather than dependent on which options a given request happened to set.
 *
 * An array-valued filter (a multi-select checkbox's OR set) is deduplicated
 * and sorted before stringification, so `['a', 'b']` and `['b', 'a']` —
 * equivalent as sets — always produce the same key. Without this, a cursor
 * minted while paginating one order of the same selection would be rejected
 * (or worse, silently misinterpreted) when replayed after the client
 * re-serializes the URL in a different order. An empty array normalizes to
 * `null` too: `applyEqualityOrInFilter`/`matchesAnyFilterValue` both treat
 * `[]` and `undefined`/`null` identically as "no filter", so a cursor minted
 * under `{ status: [] }` must replay cleanly against a later request that
 * omits `status` entirely rather than throwing a spurious filterKey mismatch.
 * @param filters - The filter-affecting subset of the caller's options, as a
 *   plain object literal in the desired key order.
 * @returns A canonical JSON string uniquely identifying the filter set.
 */
export function buildFilterKey(filters: Record<string, unknown>): string {
	const normalized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(filters)) {
		normalized[key] = Array.isArray(value)
			? value.length === 0
				? null
				: [...new Set(value)].toSorted()
			: (value ?? null);
	}
	return JSON.stringify(normalized);
}
