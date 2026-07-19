import type { GetErrorKindsOptions } from './types.js';

/** Valid values for {@link GetErrorKindsOptions.sortBy}. */
const SORT_FIELDS = ['host', 'kind', 'count'] as const;

/** The validated `sortBy`/`sortOrder` pair {@link resolveErrorKindsSort} returns. */
export interface ResolvedErrorKindsSort {
	/** Always one of `SORT_FIELDS` — never the caller's raw, unvalidated value. */
	sortBy: (typeof SORT_FIELDS)[number];
	/** Always `'asc'` or `'desc'` — never `undefined`. */
	sortOrder: 'asc' | 'desc';
}

/**
 * Clamps an untyped `sortBy` to `{host, kind, count}` (falling back to
 * `'count'` for anything else, e.g. a hand-edited `?sortBy=` query string
 * that bypassed the `GetErrorKindsOptions` type) and resolves `sortOrder`'s
 * default from the *clamped* value — shared by `getErrorKinds` (legacy),
 * `getViewerErrorKinds` (SQL fast path), and the viewer's
 * `error-kinds-cache.ts` (JS re-application over a cached snapshot) so this
 * one decision can't drift out of sync between the three implementations of
 * the same options contract. Computing `sortOrder` from the *raw* `sortBy`
 * instead of the clamped one is the mistake this function exists to
 * prevent: it silently flips the default direction for any out-of-range
 * `sortBy` value.
 * @param options - The caller-supplied `sortBy`/`sortOrder`.
 * @returns The validated `sortBy` and its resolved `sortOrder`.
 * @example
 * const { sortBy, sortOrder } = resolveErrorKindsSort({ sortBy: 'host' });
 * // { sortBy: 'host', sortOrder: 'asc' }
 */
export function resolveErrorKindsSort(
	options: Pick<GetErrorKindsOptions, 'sortBy' | 'sortOrder'>,
): ResolvedErrorKindsSort {
	const sortBy = SORT_FIELDS.includes(options.sortBy as (typeof SORT_FIELDS)[number])
		? (options.sortBy as (typeof SORT_FIELDS)[number])
		: 'count';
	const sortOrder = options.sortOrder ?? (sortBy === 'count' ? 'desc' : 'asc');
	return { sortBy, sortOrder };
}
