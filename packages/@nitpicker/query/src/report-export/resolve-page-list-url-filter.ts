import type { ArchiveAccessor } from '@nitpicker/crawler';

import { normalizeArchiveUrl } from '../normalize-archive-url.js';

/** Result of {@link resolvePageListUrlFilter}. */
export interface ResolvedPageListUrlFilter {
	/** Normalized, deduplicated URLs — ready to pass as `PageListRowFilterOptions.urls`. */
	readonly urls: string[];
	/** Input URLs that could not be normalized (unparseable, or a non-HTTP scheme). */
	readonly unparseable: string[];
}

/**
 * Normalizes an operator-supplied URL list to the exact form the Page List
 * row set compares against, using the target archive's own `disableQueries`
 * setting.
 *
 * `content_items`/`viewer_pages` store URLs as `ExURL.withoutHashAndAuth`,
 * and that normalization depends on the archive's `disableQueries` config
 * (see {@link normalizeArchiveUrl}) — a filter built without reading that
 * flag first would silently miss every row on an archive crawled with
 * `--disable-queries`. `accessor.getConfig()` is read exactly once here and
 * reused for every URL in the list.
 * @param accessor - The archive accessor whose `disableQueries` setting governs normalization.
 * @param rawUrls - The operator-supplied URL strings, unparsed.
 * @returns Normalized, deduplicated `urls` plus any `unparseable` inputs.
 * @example
 * const { urls, unparseable } = await resolvePageListUrlFilter(accessor, [
 *   'https://example.com/a',
 *   'not a url',
 * ]);
 * // urls: ['https://example.com/a'], unparseable: ['not a url']
 */
export async function resolvePageListUrlFilter(
	accessor: ArchiveAccessor,
	rawUrls: readonly string[],
): Promise<ResolvedPageListUrlFilter> {
	const { disableQueries } = await accessor.getConfig();
	const urls = new Set<string>();
	const unparseable: string[] = [];
	for (const rawUrl of rawUrls) {
		const normalized = normalizeArchiveUrl(rawUrl, disableQueries);
		if (normalized === null) {
			unparseable.push(rawUrl);
			continue;
		}
		urls.add(normalized);
	}
	return { urls: [...urls], unparseable };
}
