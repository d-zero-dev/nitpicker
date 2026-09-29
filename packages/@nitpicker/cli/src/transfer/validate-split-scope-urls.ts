import { isValidUrl } from '../crawl/is-valid-url.js';

/**
 * Validates the scope URLs given to `split` (everything after the archive
 * path). Reuses {@link isValidUrl} — the same validity contract every
 * URL-list entry point in `crawl` shares.
 * @param urls - Raw positional scope-URL arguments, as given.
 * @returns The distinct URLs, in argument order (a duplicate is silently
 *   dropped — it changes nothing about the resulting scope).
 * @throws {Error} If `urls` is empty, or any entry fails `isValidUrl`.
 * @example
 * ```ts
 * const scopeUrls = validateSplitScopeUrls(['https://example.com/blog/']);
 * ```
 */
export function validateSplitScopeUrls(urls: readonly string[]): string[] {
	if (urls.length === 0) {
		throw new Error('split requires at least one scope URL after the archive path');
	}
	for (const url of urls) {
		if (!isValidUrl(url)) {
			throw new Error(`Not a valid URL: ${url}`);
		}
	}
	return [...new Set(urls)];
}
