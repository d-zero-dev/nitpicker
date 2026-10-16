/**
 * Pins the native alias keys (`computeTierAAliasKey` / `computeTierBAliasKey`,
 * computed by the `nitpicker_url_key` crate) to the JavaScript implementation
 * in this directory (`parse-alias-key-parts.ts`, `format-alias-key.ts`), kept
 * only as the oracle for this spec. The groupings stored in existing archives
 * (`content_items.alias_of_id`) were computed with these keys, so any
 * divergence — a different reading of an odd URL by Rust's `url` crate and
 * Node's URL parser — would regroup pages on the next `viewer-build`.
 */
import { describe, it, expect } from 'vitest';

import { computeTierAAliasKey } from './compute-tier-a-alias-key.js';
import { computeTierBAliasKey } from './compute-tier-b-alias-key.js';
import { formatAliasKey } from './format-alias-key.js';
import { parseAliasKeyParts } from './parse-alias-key-parts.js';

/**
 * The Tier A key as the JavaScript implementation computes it.
 * @param url - The URL string.
 */
function tierAInJavaScript(url: string): string | null {
	const parts = parseAliasKeyParts(url);
	return parts ? formatAliasKey(parts) : null;
}

/**
 * The Tier B key as the JavaScript implementation computes it.
 * @param url - The URL string.
 */
function tierBInJavaScript(url: string): string | null {
	const parts = parseAliasKeyParts(url);
	if (!parts) {
		return null;
	}
	const path =
		parts.path.length > 1 && parts.path.endsWith('/')
			? parts.path.slice(0, -1)
			: parts.path;
	return formatAliasKey({ ...parts, path });
}

/**
 * Asserts that both keys of `url` are what the oracle computes.
 * @param url - The URL string.
 */
function expectParity(url: string): void {
	expect(computeTierAAliasKey(url), `tier A of ${JSON.stringify(url)}`).toBe(
		tierAInJavaScript(url),
	);
	expect(computeTierBAliasKey(url), `tier B of ${JSON.stringify(url)}`).toBe(
		tierBInJavaScript(url),
	);
}

/** URLs picked for the places the two URL parsers could read differently. */
const EXAMPLES = [
	'https://example.com',
	'https://example.com/',
	'http://Example.COM/About/Index.HTML',
	'https://example.com/index.html',
	'https://example.com/index.',
	'https://example.com/index.tar.gz',
	'https://example.com/index/',
	'https://example.com/a/INDEX.PHP?x=1',
	'https://example.com/a//b///index.html',
	'https://example.com/a/./b/../c/',
	'https://example.com/a/%2e%2e/b',
	'https://example.com/a/%2E/b/',
	'https://example.com/a b/c d',
	'https://example.com/a\\b\\c',
	'https://example.com\\a\\b',
	'https://example.com/%E3%81%82/index.html',
	'https://example.com/あ/index.html',
	'https://example.com/\u{1F600}/',
	'https://example.com/%zz/%/%4',
	'https://example.com/a?',
	'https://example.com/a?#x',
	'https://example.com/a?x=1&y=2#frag',
	'https://example.com/a?q=あ&r=%E3',
	'https://example.com/a?q=a b',
	'https://example.com/a?q=\'"<>`',
	'https://example.com/a#frag?x',
	'https://example.com:80/a',
	'https://example.com:443/a',
	'http://example.com:80/a',
	'http://example.com:443/a',
	'https://example.com:8443/a/',
	'https://example.com:0/a',
	'https://example.com:65535/a',
	'https://example.com:65536/a',
	'https://example.com:/a',
	'https://user:pass@example.com/a',
	'https://user@Example.com:8080/a/index.htm',
	'https://[::1]/a',
	'http://[::1]:3000/a/',
	'http://[2001:DB8::1]/a',
	'http://[0:0:0:0:0:0:0:1]/',
	'http://127.0.0.1/a',
	'http://0x7f.1/a',
	'http://2130706433/a',
	// Octal dotted quad for 192.0.2.1 (TEST-NET-1).
	'http://0300.0.02.01/a',
	'https://日本語.example/a',
	'https://xn--wgv71a119e.example/a',
	'https://EXAMPLE.com./a',
	// cspell:disable-next-line
	'https://exa mple.com/a',
	'https://exa%6Dple.com/a',
	'https://example.com\t/a\n/b',
	'  https://example.com/a  ',
	'HTTPS://EXAMPLE.COM/A',
	'https:example.com/a',
	'https:/example.com/a',
	'https:///example.com/a',
	'https://',
	'http://a/b/../../..',
	'file:///a/b',
	'ftp://example.com/a',
	'mailto:a@example.com',
	'javascript:void(0)',
	'data:text/plain,hello',
	'/relative/path',
	'//example.com/a',
	'example.com/a',
	'not a url',
	'',
	'https://example.com/a%00b',
	'https://example.com/\u{0}',
	'https://example.com/\u{7F}',
	'https://example.com/\u{FF5E}\u{FF5E}/',
	'https://example.com/\u{D7FF}\u{E000}',
	'https://ex\u{FF41}mple.com/a',
	'https://example.com/%E3%81',
	'https://example.com/a;b=c/d',
	'https://example.com/a,b/c',
	'https://example.com/a:b/c',
	'https://example.com/a@b/c',
	'https://example.com/index.html/',
	'https://example.com/index.html/index.html',
	'https://example.com/x/index.php3',
	'https://example.com/x/index._',
	'https://example.com/x/index.é',
	'https://example.com/x/index.a-b',
	'https://example.com/x/Index.Html?y=2',
];

/** Pieces the random URLs are assembled from. */
const SCHEMES = ['http', 'https', 'HTTP', 'ftp', 'mailto', ''];
const HOSTS = [
	'example.com',
	'Example.COM',
	'a.example.com:8080',
	'example.com:443',
	'example.com:80',
	'[::1]',
	'[::1]:8080',
	'127.0.0.1',
	'日本語.example',
	'xn--wgv71a119e.example',
	'user@example.com',
	'',
];
const SEGMENTS = [
	'a',
	'B',
	'index.html',
	'INDEX.PHP',
	'index.',
	'index',
	'index.tar.gz',
	'.',
	'..',
	'%2e',
	'%2E%2e',
	'%E3%81%82',
	'あ',
	'a b',
	'a%20b',
	'\u{1F600}',
	'\u{FF5E}',
	'x;y',
	'x:y',
	'',
];
const TAILS = ['', '/', '?', '?x=1', '?x=1&y=あ', '#f', '?a#b', '?a b'];

/**
 * A small deterministic generator, so a failure names the same URL on every run.
 * @param seed - The start state.
 */
function createRandom(seed: number): (limit: number) => number {
	let state = seed;
	return (limit) => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return Math.floor((state / 0x1_00_00_00_00) * limit);
	};
}

describe('alias keys: native versus the JavaScript oracle', () => {
	it.each(EXAMPLES)('agrees on %j', (url) => {
		expectParity(url);
	});

	it('agrees on ten thousand generated URLs', () => {
		const next = createRandom(429);
		for (let count = 0; count < 10_000; count++) {
			const segments = Array.from(
				{ length: next(5) },
				() => SEGMENTS[next(SEGMENTS.length)]!,
			);
			const separator = next(8) === 0 ? '\\' : '/';
			const url = `${SCHEMES[next(SCHEMES.length)]}://${HOSTS[next(HOSTS.length)]}/${segments.join(separator)}${TAILS[next(TAILS.length)]}`;
			expectParity(url);
		}
	});
});
