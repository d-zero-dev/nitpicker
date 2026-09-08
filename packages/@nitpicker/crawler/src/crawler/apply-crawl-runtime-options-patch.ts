import type {
	CrawlerOptions,
	CrawlRuntimeOptions,
	CrawlRuntimeOptionsPatch,
} from './types.js';

/**
 * Merges `additions` into `existing`, appending only entries not already
 * present (order-preserving, first occurrence wins) — the same
 * `[...new Set([...a, ...b])]` idiom `crawler-orchestrator.ts` already uses
 * for root/URL merges (`mergedRoots`, `shapeKeysToFinalize`).
 * @param existing - The current array.
 * @param additions - Entries to add, or `undefined` to leave `existing` unchanged.
 * @returns A new array — `existing` itself when `additions` is `undefined` or empty.
 */
function mergeUnique(
	existing: readonly string[],
	additions: readonly string[] | undefined,
): readonly string[] {
	if (!additions || additions.length === 0) {
		return existing;
	}
	return [...new Set([...existing, ...additions])];
}

/**
 * Validates every field of `patch` before any mutation, so a single invalid
 * field (e.g. `parallels: 0`) cannot leave `options` half-updated.
 * @param patch - The patch to validate.
 * @throws {RangeError} If `parallels` is present and not an integer `>= 1`, or `interval` is present and not an integer `>= 0`.
 * @throws {TypeError} If any exclude entry is present and not a non-empty string.
 */
function assertValidPatch(patch: CrawlRuntimeOptionsPatch): void {
	if (
		patch.parallels !== undefined &&
		(!Number.isInteger(patch.parallels) || patch.parallels < 1)
	) {
		throw new RangeError(`parallels must be an integer >= 1, got ${patch.parallels}`);
	}
	if (
		patch.interval !== undefined &&
		(!Number.isInteger(patch.interval) || patch.interval < 0)
	) {
		throw new RangeError(`interval must be an integer >= 0, got ${patch.interval}`);
	}
	for (const [field, entries] of [
		['excludes', patch.excludes],
		['excludeUrls', patch.excludeUrls],
		['excludeKeywords', patch.excludeKeywords],
	] as const) {
		if (!entries) continue;
		for (const entry of entries) {
			if (typeof entry !== 'string' || entry.length === 0) {
				throw new TypeError(
					`${field} entries must be non-empty strings, got ${JSON.stringify(entry)}`,
				);
			}
		}
	}
}

/**
 * Applies a runtime patch to a live {@link CrawlerOptions} object in place
 * and returns a snapshot of the affected fields.
 *
 * `parallels`/`interval` overwrite the current value. The three exclude
 * arrays are additive only — new entries are appended (duplicates against
 * the existing array dropped); there is no way to remove an already-set
 * exclude pattern through this function. `Crawler#updateRuntimeOptions`
 * (the only caller) reads `options.excludes`/`.excludeUrls`/
 * `.excludeKeywords`/`.parallels`/`.interval` fresh on every use — see
 * `shouldSkipUrl`'s call site in `crawler.ts` and the per-URL interval
 * check — so replacing these fields with new arrays/values here takes
 * effect starting with the next URL a worker picks up, without any cache
 * to invalidate.
 * @param options - The live options object to mutate.
 * @param patch - The runtime change to apply.
 * @returns A snapshot of `parallels`/`interval`/the three exclude arrays after applying `patch`.
 * @throws {RangeError} If `parallels` is present and not an integer `>= 1`, or `interval` is present and not an integer `>= 0`.
 * @throws {TypeError} If any exclude entry is present and not a non-empty string.
 * @example
 * ```ts
 * const snapshot = applyCrawlRuntimeOptionsPatch(options, {
 *   parallels: 4,
 *   excludes: ['/admin/**'],
 * });
 * console.log(snapshot.parallels); // 4
 * ```
 */
export function applyCrawlRuntimeOptionsPatch(
	options: CrawlerOptions,
	patch: CrawlRuntimeOptionsPatch,
): CrawlRuntimeOptions {
	assertValidPatch(patch);

	if (patch.parallels !== undefined) {
		options.parallels = patch.parallels;
	}
	if (patch.interval !== undefined) {
		options.interval = patch.interval;
	}
	options.excludes = [...mergeUnique(options.excludes, patch.excludes)];
	options.excludeUrls = mergeUnique(options.excludeUrls, patch.excludeUrls);
	options.excludeKeywords = [
		...mergeUnique(options.excludeKeywords, patch.excludeKeywords),
	];

	return {
		parallels: options.parallels,
		interval: options.interval,
		excludes: options.excludes,
		excludeUrls: options.excludeUrls,
		excludeKeywords: options.excludeKeywords,
	};
}
