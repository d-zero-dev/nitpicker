import type { ExURL, ParseURLOptions } from '@d-zero/shared/parse-url';
import type { Knex } from 'knex';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';

import { findScopeEntry } from '../../crawler/find-scope-entry.js';

/**
 * Counts `content_items` rows that are `is_external = 1` yet fall inside
 * the given scope — exactly the set `crawl <out> --append <root>`'s
 * `repromoteExternalPages` would re-fetch as internal pages. Concat never
 * runs that promotion itself (see `types.ts`'s `ConcatArchivesResult.externalInScopeCount`
 * docs for why), so this count is what the CLI surfaces as its
 * `--append` hint after a merge.
 *
 * Split never calls this (its output scope is a SUBSET of its single
 * source's scope, so nothing newly falls into scope), but the function
 * is written generically rather than concat-specific for the same reason
 * `flattenRedirectChains` is: a narrower, single-purpose name would
 * invite a second near-duplicate implementation later.
 * @param trx - The destination transaction.
 * @param scope - The output archive's final scope map.
 * @param options - URL parsing options forwarded to {@link findScopeEntry}.
 * @returns The count of in-scope-but-still-external pages.
 * @example
 * ```ts
 * const scope = buildScopeMap(mergedConfig.roots, mergedConfig);
 * const hintCount = await countExternalPagesInScope(knex, scope, mergedConfig);
 * ```
 */
export async function countExternalPagesInScope(
	trx: Knex,
	scope: ReadonlyMap<string, readonly ExURL[]>,
	options?: ParseURLOptions,
): Promise<number> {
	const candidates: { url: string }[] = await trx
		.select('url_refs.url as url')
		.from('content_items')
		.join('url_refs', 'url_refs.id', 'content_items.url_id')
		.where('content_items.is_external', 1);

	let count = 0;
	for (const row of candidates) {
		const parsed = parseUrl(row.url, options);
		if (parsed && findScopeEntry(parsed, scope, options) !== null) {
			count++;
		}
	}
	return count;
}
