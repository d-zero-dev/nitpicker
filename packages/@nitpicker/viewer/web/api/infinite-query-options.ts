/**
 * Shared options threaded through every `use-*-infinite.ts` hook so the list
 * views can switch the virtual-mode query off while the user is in MPA mode.
 *
 * Kept as a one-field interface (rather than a re-used `enabled?: boolean`
 * inline) so the intent is obvious at the call site (`{enabled: mode ===
 * 'virtual'}`) and so any future shared flag has a place to land without
 * touching nine files.
 */
export interface InfiniteQueryOptions {
	/**
	 * Suppresses the request when `false`. The MPA equivalent
	 * ({@link import('./use-paged-query.js').usePagedQuery}) runs in its place.
	 */
	enabled?: boolean;
}
