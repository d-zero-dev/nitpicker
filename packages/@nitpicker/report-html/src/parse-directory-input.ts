import type { HtmlReportDirectoryPrefix } from './types.js';
import type { PageDirectoryPrefix } from '@nitpicker/query';

import { parsePageDirectoryPrefix } from '@nitpicker/query';

/**
 * Matches a token written as an absolute URL. Pathname-only input is the
 * remainder: it must start with `/` (including `//blog`, which is a path
 * with repeated slashes — not a protocol-relative URL).
 */
const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:\/\//iu;

/**
 * Turns query's host+pathname parse into the CLI prefix shape: pathname-only
 * root is shown as `/`, and a host filter is rebuilt as `https://{host}{path}`
 * because `parsePageDirectoryPrefix` ignores scheme and port.
 * @param parsed - Output of {@link parsePageDirectoryPrefix}.
 * @returns The corresponding HTML-report prefix.
 */
function toHtmlReportDirectoryPrefix(
	parsed: PageDirectoryPrefix,
): HtmlReportDirectoryPrefix {
	if (parsed.hostname == null) {
		const pathname = parsed.pathname === '' ? '/' : parsed.pathname;
		return { origin: null, pathname, display: pathname };
	}
	const pathname = parsed.pathname === '' ? '/' : parsed.pathname;
	const display = `https://${parsed.hostname}${parsed.pathname}`;
	return {
		origin: `https://${parsed.hostname}`,
		pathname,
		display,
	};
}

/**
 * Parses comma-separated full URLs or absolute pathnames for report filtering.
 *
 * Normalization is {@link parsePageDirectoryPrefix} (full URLs go through
 * `@d-zero/shared/parse-url`). This wrapper only rejects relative tokens such
 * as `docs`, which the query parser would treat as `/docs`.
 *
 * Pathnames are not fed to `new URL(..., base)`: a leading `//` is a
 * protocol-relative URL there, so `//blog` would collapse to the site root.
 * @param input - User-provided comma-separated value.
 * @returns Deduplicated normalized directory prefixes.
 * @throws {Error} If any token is empty, relative, or non-HTTP.
 * @example
 * parseDirectoryInput('/docs,https://example.com/help')
 */
export function parseDirectoryInput(input: string): HtmlReportDirectoryPrefix[] {
	const rawTokens = input.split(',').map((token) => token.trim());
	if (rawTokens.length === 0 || rawTokens.some((token) => token.length === 0)) {
		throw new Error('Enter one or more comma-separated directory prefixes.');
	}

	const prefixes = rawTokens.map((token): HtmlReportDirectoryPrefix => {
		if (!token.startsWith('/') && !ABSOLUTE_URL.test(token)) {
			throw new Error(`Directory prefix must be a full URL or start with "/": ${token}`);
		}
		try {
			return toHtmlReportDirectoryPrefix(parsePageDirectoryPrefix(token));
		} catch (error) {
			throw new Error(`Directory URL must use http or https: ${token}`, { cause: error });
		}
	});

	return [
		...new Map(
			prefixes.map((prefix) => [`${prefix.origin ?? ''}\0${prefix.pathname}`, prefix]),
		).values(),
	];
}
