import { tryParseUrl } from '@d-zero/shared/parse-url';

/**
 * Normalizes a raw URL string to the exact form `viewer_pages.url` /
 * `url_refs.url` store it in — `ExURL.withoutHashAndAuth`, computed with the
 * archive's own `disableQueries` setting.
 *
 * The normalization depends on `disableQueries` because
 * `@d-zero/shared/parse-url`'s query-string handling (sorting keys, dropping
 * `PHPSESSID`) only runs when that flag is `false` — an archive crawled with
 * `--disable-queries` stores URLs with their query string stripped entirely,
 * so a caller matching against it must normalize the same way or every
 * comparison silently misses. Callers read this flag once via
 * `accessor.getConfig()` and pass it through for every URL in a batch (see
 * `resolvePageListUrlFilter` / `matchUrlList`).
 * @param url - The raw URL string to normalize (as typed by an operator).
 * @param disableQueries - The archive's `Config.disableQueries` value.
 * @returns The normalized `withoutHashAndAuth` string, or `null` when `url`
 *   is not a parseable HTTP(S) URL (unparseable entirely, or a non-HTTP
 *   scheme like `mailto:`).
 * @example
 * normalizeArchiveUrl('https://example.com/a?b=2&a=1#frag', false);
 * // 'https://example.com/a?a=1&b=2'
 */
export function normalizeArchiveUrl(url: string, disableQueries: boolean): string | null {
	const parsed = tryParseUrl(url, { disableQueries });
	if (!parsed || !parsed.isHTTP) {
		return null;
	}
	return parsed.withoutHashAndAuth;
}
