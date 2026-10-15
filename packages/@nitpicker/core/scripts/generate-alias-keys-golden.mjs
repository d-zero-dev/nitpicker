// Regenerates `crates/nitpicker_url_key/tests/fixtures/alias-keys-golden.json`
// from the JavaScript alias keys in `@nitpicker/archive` (`src/url-alias/
// parse-alias-key-parts.ts`, `format-alias-key.ts`), the oracle the native
// keys are pinned to. Each case stores its URL as UTF-8 hex, so a string
// `serde_json` cannot hold stays representable.
//
// The fixture only needs regenerating when a URL is added to `EXAMPLES`; a
// change in its output without such an edit means the JavaScript keys (or the
// Node URL parser they rely on) changed, which `compute-alias-keys.parity.spec.ts`
// reports as well. The oracle files are TypeScript, so this needs Node's type
// stripping (Node 24 or later).
//
// Usage: node generate-alias-keys-golden.mjs [output.json]
//   (default: the fixture next to the crate's test)
import { writeFileSync } from 'node:fs';

import { formatAliasKey } from '../../archive/src/url-alias/format-alias-key.ts';
import { parseAliasKeyParts } from '../../archive/src/url-alias/parse-alias-key-parts.ts';

const defaultOutput = new URL(
	'../crates/nitpicker_url_key/tests/fixtures/alias-keys-golden.json',
	import.meta.url,
);

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
	'https://example.com:80/a',
	'https://example.com:443/a',
	'http://example.com:80/a',
	'http://example.com:443/a',
	'https://example.com:8443/a/',
	'https://example.com:/a',
	'https://user:pass@example.com/a',
	'https://[::1]/a',
	'http://[::1]:3000/a/',
	'http://[2001:DB8::1]/a',
	'http://127.0.0.1/a',
	'http://0x7f.1/a',
	'http://2130706433/a',
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
	'https:///example.com/a',
	'https://',
	'file:///a/b',
	'ftp://example.com/a',
	'mailto:a@example.com',
	'javascript:void(0)',
	'/relative/path',
	'//example.com/a',
	'example.com/a',
	'not a url',
	'',
	'https://example.com/a%00b',
	'https://example.com/index.html/',
	'https://example.com/x/index._',
	'https://example.com/x/index.é',
	'https://example.com/x/index.a-b',
	'https://example.com/x/Index.Html?y=2',
];

/**
 * @param {string} url - A URL string.
 * @returns {{ tierA: string | null; tierB: string | null }} The oracle's keys.
 */
function oracle(url) {
	const parts = parseAliasKeyParts(url);
	if (!parts) {
		return { tierA: null, tierB: null };
	}
	const path =
		parts.path.length > 1 && parts.path.endsWith('/')
			? parts.path.slice(0, -1)
			: parts.path;
	return { tierA: formatAliasKey(parts), tierB: formatAliasKey({ ...parts, path }) };
}

const output = process.argv[2] ?? defaultOutput;
const cases = EXAMPLES.map((url) => ({
	name: JSON.stringify(url),
	utf8Hex: Buffer.from(url, 'utf8').toString('hex'),
	...oracle(url),
}));
writeFileSync(output, `${JSON.stringify(cases, null, '\t')}\n`);
console.log(`wrote ${cases.length} cases`);
