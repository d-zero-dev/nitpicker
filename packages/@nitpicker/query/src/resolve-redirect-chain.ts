/**
 * Walk a redirect chain to its final destination, returning the destination's
 * `pageId` — or `null` if the chain forms a cycle.
 *
 * Used by cluster computation (`compute-isolated-clusters`) and link analysis
 * (`list-links`) to treat redirect-source rows as URL aliases of their
 * destination. The user-facing mental model is "redirect-source is not a
 * page; its destination is the page" — so any anchor that points at a
 * redirect-source must be resolved through the chain to the canonical
 * destination before edges / link reports are computed.
 *
 * Cycle detection is necessary because malformed archive data (e.g. a row
 * with `redirectDestId` pointing back at itself, or a circular chain) could
 * otherwise loop forever. `visited` is a per-invocation Set so concurrent
 * resolutions remain independent. Returning `null` on cycle lets callers
 * skip the offending edge rather than crash the whole query.
 *
 * Pure: takes an in-memory `redirectMap` (built once by the caller) so the
 * walk costs O(chain length) without re-querying SQLite per hop. The caller
 * should build the map from a single `SELECT id, redirectDestId FROM pages
 * WHERE redirectDestId IS NOT NULL` so the map only carries the active
 * redirect edges, not every page row.
 * @param startId - The `pageId` to start walking from.
 * @param redirectMap - Map of `pageId → redirectDestId`, containing only rows that have a non-null `redirectDestId`.
 * @returns The terminal (non-redirect) `pageId` reached by walking the chain, or `null` if a cycle is detected.
 */
export function resolveRedirectChain(
	startId: number,
	redirectMap: ReadonlyMap<number, number>,
): number | null {
	const visited = new Set<number>();
	let current = startId;
	while (redirectMap.has(current)) {
		if (visited.has(current)) {
			return null;
		}
		visited.add(current);
		// Map.get cannot return undefined here because `redirectMap.has(current)` is true on this branch.
		current = redirectMap.get(current) as number;
	}
	return current;
}
