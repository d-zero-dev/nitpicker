import type { HtmlReportDirectoryPrefix } from './types.js';

/**
 *
 * @param pathname
 */
function normalizePathname(pathname: string): string {
	const normalized = new URL(pathname, 'https://example.com').pathname;
	return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
}

/**
 * Parses comma-separated full URLs or absolute pathnames for report filtering.
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
		if (token.startsWith('/')) {
			const pathname = normalizePathname(token.split(/[?#]/u)[0] ?? token);
			return { origin: null, pathname, display: pathname };
		}

		let url: URL;
		try {
			url = new URL(token);
		} catch {
			throw new Error(`Directory prefix must be a full URL or start with "/": ${token}`);
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			throw new Error(`Directory URL must use http or https: ${token}`);
		}
		const pathname = normalizePathname(url.pathname);
		const display = `${url.origin}${pathname}`;
		return { origin: url.origin, pathname, display };
	});

	return [
		...new Map(
			prefixes.map((prefix) => [`${prefix.origin ?? ''}\0${prefix.pathname}`, prefix]),
		).values(),
	];
}
