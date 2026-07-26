import type { AliasKeyParts } from './types.js';

const INDEX_SUFFIX_PATTERN = /\/index\.\w+$/i;

/**
 * Parses `url` and extracts the components Tier A / Tier B keys are built
 * from. Returns `null` for anything that isn't a parseable `http`/`https`
 * URL — such a row is defensively excluded from alias candidacy entirely
 * (a non-http(s) URL should not occur for anything the crawler itself
 * stored, since every `url_refs.url` was already parsed once during
 * crawling).
 * @param url - The URL string to parse.
 * @returns The extracted parts, or `null` if unparseable / not http(s).
 * @example
 * parseAliasKeyParts('https://Example.com/about/index.html');
 * // { host: 'example.com', port: '', path: '/about/', search: '' }
 */
export function parseAliasKeyParts(url: string): AliasKeyParts | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		return null;
	}
	return {
		// WHATWG URL already lowercases `hostname` during parsing; the
		// explicit `.toLowerCase()` documents that intent rather than
		// relying on it silently.
		host: parsed.hostname.toLowerCase(),
		// Empty string when the port is the scheme's default (or
		// unspecified) — this is why `http://example.com/` and
		// `https://example.com/` fold to the same key below (both have
		// `port === ''`) while an explicit non-default port on either
		// scheme is preserved and kept distinct.
		port: parsed.port,
		path: parsed.pathname.replace(INDEX_SUFFIX_PATTERN, '/'),
		search: parsed.search,
	};
}
