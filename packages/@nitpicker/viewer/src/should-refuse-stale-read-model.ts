import type { ArchiveMode } from '@nitpicker/query';

/**
 * Decides whether a read-model-backed route should refuse to serve a
 * request via its live SQL fallback, instead of silently degrading to it.
 *
 * The viewer's dual-path routes (`register-pages-route.ts` and siblings)
 * fall back to a live, write-model query in three distinct situations, only
 * one of which should now surface as a hard "unavailable" response:
 *
 * - **stub mode** (a live crawl in progress): the read model cannot exist
 *   yet by construction (`buildViewerReadModel` refuses read-only
 *   accessors, and `viewer-build` refuses stub directories) — live is the
 *   only option, so this always returns `false` here.
 * - **a filter/sortBy the fast path cannot express** (e.g.
 *   `includeRedirectSources` on broken links — see ARCHITECTURE.md's
 *   `includeRedirectSources` invariant): the read model may be perfectly
 *   current, but this specific request still needs the wide table. This
 *   function is not involved in that decision at all — routes keep
 *   evaluating their own `usesWideTableOnlyFilter`-style guard first and
 *   only consult this helper for the remaining "no forced-live filter, but
 *   the read model itself is missing/stale" case.
 * - **the read model is missing/stale, outside stub mode**: this is the
 *   case this function exists to catch. Silent live fallback is not an
 *   option here: a schema-version bump invalidates every archive's read
 *   model at once, so falling back silently would surface only as "every
 *   archive's `/api/pages` got slow" with no signal that re-running
 *   `viewer-build` would fix it (the `#196`→v22 bump went unnoticed this way
 *   in practice — see ARCHITECTURE.md's fast-path invariant on this).
 * @param mode - The archive's mode (`'archive'` or `'stub'`).
 * @param isReadModelCurrent - The result of `isViewerReadModelCurrent` for
 *   this accessor.
 * @returns `true` iff the caller should respond with a structured
 *   "unavailable" payload instead of invoking its live fallback.
 * @example
 * if (!usesWideTableOnlyFilter && isCurrent) {
 *   return c.json(await listViewerPages(accessor, options));
 * }
 * // Guard with `!usesWideTableOnlyFilter` too: a forced-live filter must
 * // stay live even when the read model happens to also be stale — it was
 * // never going to use the fast path regardless of freshness.
 * if (!usesWideTableOnlyFilter && shouldRefuseStaleReadModel(context.mode, isCurrent)) {
 *   return c.json({ available: false, reason: 'read-model-required' } satisfies ReadModelUnavailable);
 * }
 * return c.json(await listPages(accessor, options)); // legitimate live path
 */
export function shouldRefuseStaleReadModel(
	mode: ArchiveMode,
	isReadModelCurrent: boolean,
): boolean {
	return mode !== 'stub' && !isReadModelCurrent;
}
