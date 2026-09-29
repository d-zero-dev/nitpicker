import type { Config } from '../types.js';

import { REQUIRED_FORMAT_VERSION } from '../meta/assert-compatible-version.js';

/**
 * Derives the output {@link Config} for a `split`, from the source's own
 * config plus the scope URLs the operator gave on the command line.
 *
 * `roots` becomes exactly the given URLs (their `withoutHash` form,
 * matching how `crawl`'s own roots are recorded); `baseUrl` is the first
 * one. Every other scalar field is carried over verbatim from the
 * source — a split narrows WHICH pages are kept, it does not change HOW
 * they were crawled (`recursive`/`interval`/`userAgent`/etc. all still
 * describe the original session honestly). `excludes`/`excludeKeywords`/
 * `excludeUrls` are likewise carried over unchanged (they described the
 * source's own crawl-time exclusions, still true of the subset that
 * survives). `version` is pinned to {@link REQUIRED_FORMAT_VERSION} and
 * `createdCwd` is always `null`, matching `mergeArchiveConfigs`'s same
 * two fields for the same reasons.
 *
 * Callers must reject a `fromList` source BEFORE calling this — `roots`
 * for such an archive is a URL LIST, not a scope, so "roots = the given
 * scope URLs" has no coherent meaning for it (see `docs/split.md`).
 * @param source - The source archive's `getConfig()` result.
 * @param scopeUrls - The scope URLs the operator gave (`withoutHash` form).
 * @param name - The output archive's `name` (typically its basename).
 * @returns The derived {@link Config} to write via `Archive#setConfig`.
 * @example
 * ```ts
 * const config = buildSplitConfig(await source.getConfig(), ['https://example.com/blog/'], 'blog');
 * ```
 */
export function buildSplitConfig(
	source: Config,
	scopeUrls: readonly string[],
	name: string,
): Config {
	if (scopeUrls.length === 0) {
		throw new Error('buildSplitConfig: at least one scope URL is required');
	}
	return {
		...source,
		version: REQUIRED_FORMAT_VERSION,
		name,
		roots: [...scopeUrls],
		baseUrl: scopeUrls[0]!,
		createdCwd: null,
	};
}
