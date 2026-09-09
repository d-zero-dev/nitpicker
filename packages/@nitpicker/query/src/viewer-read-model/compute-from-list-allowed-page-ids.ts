import type { Knex } from 'knex';

import { eachSplitted } from '@nitpicker/crawler';

import { normalizeArchiveUrl } from '../normalize-archive-url.js';
import { SQLITE_IN_CHUNK } from '../sqlite-in-chunk.js';

/** Named parameters for {@link computeFromListAllowedPageIds}. */
export interface ComputeFromListAllowedPageIdsOptions {
	/** The open transaction to query through. */
	readonly trx: Knex;
	/**
	 * `Config.roots` verbatim — the `--list`/`--list-file` URLs the crawl was
	 * started from, stored in `withoutHash` form (auth preserved, see
	 * `crawler-orchestrator.ts`'s `rootHrefs`).
	 */
	readonly roots: readonly string[];
	/** `Config.disableQueries`, forwarded to {@link normalizeArchiveUrl}. */
	readonly disableQueries: boolean;
}

/** Row shape read from the `content_items` join, one per matched root URL. */
interface RootRow {
	rootId: number;
	redirectDestId: number | null;
	aliasOfId: number | null;
	redirectTargetAliasOfId: number | null;
}

/**
 * Computes the set of internal `content_items.id` values a `fromList`
 * archive's `viewer_pages` is allowed to surface: each root URL's own row,
 * plus the page its redirect (and, if that destination is itself a
 * non-representative alias-group member, its alias) resolves to.
 *
 * A `--list`/`--list-file` crawl only ever registers its root URLs as full
 * scrape targets (see `Crawler#start`'s `recursive: false` path); every
 * other internal URL it touches is a lightweight metadata-only fetch (or,
 * for a real HTTP redirect, the destination the root's content actually
 * lives at). Restricting `viewer_pages`'s internal rows to this set is what
 * keeps a `--list` archive's Page List / HTML report / viewer Pages view
 * limited to the operator's own list (plus the destinations those URLs
 * redirect to — see `build-viewer-read-model.ts`'s `fromList` docs for why
 * that inclusion, not exclusion, is correct) instead of also surfacing pages
 * a crawler bug or a dedupe-cap retry incidentally scraped in full.
 *
 * `redirect_dest_id` is already pre-flattened to the final destination at
 * write time (see ARCHITECTURE.md), so a root that redirects resolves in one
 * hop; the extra `alias_of_id` lookup on the destination handles the one
 * further hop `backfillAliasOfId` can leave (a redirect destination that is
 * itself a non-representative alias-group member — the same
 * `COALESCE(canonical_alias, canonical, alias_canonical, dest)` chain
 * `compute-anchor-fact-rows.ts` uses for the same reason). A root that is
 * itself an alias-group member (no redirect involved) resolves via its own
 * `alias_of_id`.
 * @param options - See {@link ComputeFromListAllowedPageIdsOptions}.
 * @param options.trx - The open transaction to query through.
 * @param options.roots - The `--list`/`--list-file` root URLs, verbatim.
 * @param options.disableQueries - Forwarded to `normalizeArchiveUrl`.
 * @returns The allowed `content_items.id` set. **Empty when every root
 *   failed to normalize to an HTTP(S) URL** — unlike
 *   `applyEqualityOrInFilter`'s "empty array/set means no filter" contract,
 *   an empty result here means "match nothing": the caller
 *   (`build-viewer-read-model.ts`) treats a non-null result as "restrict
 *   internal rows to this set", so silently falling back to "no
 *   restriction" on a degenerate `roots` value would be a fail-open, not a
 *   fail-safe.
 * @example
 * const allowed = await computeFromListAllowedPageIds({
 *   trx,
 *   roots: config.roots,
 *   disableQueries: config.disableQueries,
 * });
 * // allowed.has(row.id) === true for a root URL's own row or its redirect target
 */
export async function computeFromListAllowedPageIds({
	trx,
	roots,
	disableQueries,
}: ComputeFromListAllowedPageIdsOptions): Promise<ReadonlySet<number>> {
	const normalizedRoots = [
		...new Set(
			roots
				.map((root) => normalizeArchiveUrl(root, disableQueries))
				.filter((url): url is string => url !== null),
		),
	];

	const allowedIds = new Set<number>();
	await eachSplitted(normalizedRoots, SQLITE_IN_CHUNK, async (chunk) => {
		const rows: RootRow[] = await trx('content_items as root')
			.join('url_refs as ur', 'ur.id', 'root.url_id')
			.leftJoin(
				'content_items as redirect_target',
				'redirect_target.id',
				'root.redirect_dest_id',
			)
			.whereIn('ur.url', chunk)
			.select(
				'root.id as rootId',
				'root.redirect_dest_id as redirectDestId',
				'root.alias_of_id as aliasOfId',
				'redirect_target.alias_of_id as redirectTargetAliasOfId',
			);
		for (const row of rows) {
			// The root's own row is always admitted — a redirect source is now
			// a listable row in its own right (`is_redirect_source`), not just
			// a note on its destination's Redirect From column.
			allowedIds.add(row.rootId);
			const resolvedDestId =
				row.redirectDestId == null
					? row.aliasOfId
					: (row.redirectTargetAliasOfId ?? row.redirectDestId);
			if (resolvedDestId != null) {
				allowedIds.add(resolvedDestId);
			}
		}
	});

	return allowedIds;
}
