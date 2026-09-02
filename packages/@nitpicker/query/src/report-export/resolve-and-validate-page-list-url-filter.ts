import type { ArchiveAccessor } from '@nitpicker/crawler';

import { resolvePageListUrlFilter } from './resolve-page-list-url-filter.js';

/**
 * Resolves a `--urls` flag's raw input to a normalized, non-empty URL
 * allowlist, or throws — the shared "did the operator actually give us
 * something to filter on" gate for every `--urls`-accepting report backend.
 *
 * `resolvePageListUrlFilter`'s `urls` can come back empty when every input
 * line failed to parse as an HTTP(S) URL. Passing that empty array on to
 * `applyEqualityOrInFilter` would silently mean "no filter" (its
 * empty-array-is-no-filter contract), turning a mistaken or all-invalid
 * `--urls` file into an unfiltered full report — so this throws instead of
 * returning an empty array.
 * @param accessor - The archive accessor whose `disableQueries` setting governs normalization.
 * @param rawUrls - The operator-supplied URL strings, unparsed (`params.urls` from the CLI).
 * @param onWarn - Called once, with no trailing newline, when some (but not
 *   all) input URLs could not be parsed. Each report backend routes this to
 *   its own warning surface (immediate `console.warn`, or a collected
 *   `warnings` array flushed after generation).
 * @returns The normalized, deduplicated URL allowlist. Never empty.
 * @throws {Error} If every input URL failed to normalize to a valid HTTP(S) URL.
 * @example
 * const normalizedUrls = await resolveAndValidatePageListUrlFilter(accessor, params.urls, warn);
 */
export async function resolveAndValidatePageListUrlFilter(
	accessor: ArchiveAccessor,
	rawUrls: readonly string[],
	onWarn: (message: string) => void,
): Promise<readonly string[]> {
	const { urls, unparseable } = await resolvePageListUrlFilter(accessor, rawUrls);
	if (urls.length === 0) {
		throw new Error(
			'--urls matched no valid HTTP(S) URL after normalization; nothing to report.',
		);
	}
	if (unparseable.length > 0) {
		onWarn(
			`--urls: ${unparseable.length} of ${rawUrls.length} input URL(s) could not be parsed as HTTP(S) and were ignored.`,
		);
	}
	return urls;
}
