import type { Config } from '../types.js';

import { REQUIRED_FORMAT_VERSION } from '../meta/assert-compatible-version.js';

import { ArchiveConfigConflictError } from './types.js';

/** {@link Config} fields that must be IDENTICAL across every source, or concat refuses. */
const STRICT_MATCH_FIELDS = ['disableQueries', 'fromList'] as const;

/**
 * Merges two or more source archives' {@link Config} into the config
 * concat's output archive is created with.
 *
 * - `disableQueries` and `fromList` must be IDENTICAL across every
 *   source, or this throws {@link ArchiveConfigConflictError}:
 *   - `disableQueries` changes how every URL is normalised
 *     (`normalizeArchiveUrl`'s `ExURL.withoutHashAndAuth` vs. a
 *     query-stripped form) — sources crawled with different settings
 *     have incomparable `url_refs.url` values, so URL-string matching
 *     (`plan-content-items-for-concat.ts`'s whole mechanism) would
 *     silently misclassify identical URLs as distinct.
 *   - `fromList` archives restrict which internal rows the viewer read
 *     model admits to exactly `config.roots` (`computeFromListAllowedPageIds`) —
 *     mixing a `fromList` source with a recursive one has no single
 *     correct restriction rule.
 * - `roots` is the union of every source's roots, in argument order,
 *   deduplicated (a root appearing in two sources counts once).
 *   `baseUrl` is the merged `roots[0]`.
 * - `excludes` / `excludeKeywords` / `excludeUrls` are unioned the same
 *   way, order-preserving.
 * - `requestHeaderNames` is unioned too: it only records which header names
 *   ANY source needed (never values), so dropping a later source's names would
 *   silence the "re-supply these headers" warning for that source's pages.
 * - Every other scalar field (`recursive`, `interval`, `image`,
 *   `fetchExternal`, `parallels`, `maxExcludedDepth`, `retry`,
 *   `userAgent`, `ignoreRobots`, `mainContentSelector`) is taken from the
 *   FIRST source — these only ever describe how a crawl session was RUN,
 *   never the shape of the data, so there is no principled way to merge
 *   two different values and "first argument wins" is at least
 *   predictable.
 * - `version` is always {@link REQUIRED_FORMAT_VERSION} (the output is a
 *   freshly-created archive on the current format) and `createdCwd` is
 *   always `null` (never persisted into a shared `.nitpicker`, per
 *   `Archive.write()`'s own scrub — see the DB schema doc's `info.createdCwd`
 *   entry).
 * @param configs - Every source's `getConfig()` result, in argument order.
 * @param name - The output archive's `name` (typically its basename).
 * @returns The merged {@link Config} to write via `Archive#setConfig`.
 * @throws {ArchiveConfigConflictError} If `disableQueries` or `fromList`
 *   differ across `configs`.
 * @example
 * ```ts
 * const merged = mergeArchiveConfigs(
 *   [await a.getConfig(), await b.getConfig()],
 *   'merged',
 * );
 * ```
 */
export function mergeArchiveConfigs(configs: readonly Config[], name: string): Config {
	if (configs.length === 0) {
		throw new Error('mergeArchiveConfigs: at least one source config is required');
	}
	for (const field of STRICT_MATCH_FIELDS) {
		const values = configs.map((c) => c[field]);
		const distinct = new Set(values);
		if (distinct.size > 1) {
			throw new ArchiveConfigConflictError(field, values);
		}
	}

	const roots = [...new Set(configs.flatMap((c) => c.roots))];
	const excludes = [...new Set(configs.flatMap((c) => c.excludes))];
	const excludeKeywords = [...new Set(configs.flatMap((c) => c.excludeKeywords))];
	const excludeUrls = [...new Set(configs.flatMap((c) => c.excludeUrls))];
	const requestHeaderNames = [
		...new Set(configs.flatMap((c) => c.requestHeaderNames ?? [])),
	];

	const first = configs[0]!;
	return {
		...first,
		version: REQUIRED_FORMAT_VERSION,
		name,
		roots,
		baseUrl: roots[0]!,
		excludes,
		excludeKeywords,
		excludeUrls,
		requestHeaderNames,
		createdCwd: null,
	};
}
