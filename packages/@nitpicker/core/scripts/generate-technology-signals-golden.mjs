// Regenerates `crates/nitpicker_tech_detect/tests/fixtures/technology-signals-golden.json`
// from the JavaScript regular expressions in `@nitpicker/archive`
// (`src/meta/technologies/match-structural-signals-in-javascript.ts`), the
// oracle the native matcher is pinned to. Each case stores its input as UTF-8
// hex, so a string `serde_json` cannot hold (a lone surrogate) stays
// representable, and the signals the oracle reports for it: evidence cut to
// 200 UTF-16 code units and made well-formed, as SQLite stores it.
//
// The fixture needs regenerating when a case is added to `EXAMPLES` or the
// oracle expressions change on purpose. The oracle files are TypeScript, so
// this needs Node's type stripping (Node 24 or later).
//
// Usage: node generate-technology-signals-golden.mjs [output.json]
//   (default: the fixture next to the crate's test)
import { writeFileSync } from 'node:fs';

import { matchStructuralSignalsInJavaScript } from '../../archive/src/meta/technologies/match-structural-signals-in-javascript.ts';
import { STRUCTURAL_SIGNAL_DEFINITIONS } from '../../archive/src/meta/technologies/structural-signal-definitions.ts';

const defaultOutput = new URL(
	'../crates/nitpicker_tech_detect/tests/fixtures/technology-signals-golden.json',
	import.meta.url,
);

const LONG = 'x'.repeat(250);

/**
 * Inputs picked for each definition's hits and near misses, the JS `\s`
 * members outside ASCII (and near misses that are not), ASCII-only case
 * folding, overlapping literals and the 200-unit evidence cut.
 */
const EXAMPLES = [
	['empty', ''],
	['plain page', '<html><head><title>t</title></head><body><p>plain</p></body></html>'],
	['next data script', '<script type="application/json" id="__NEXT_DATA__">{}</script>'],
	['next data script uppercase', '<SCRIPT ID="__next_data__">'],
	['next data without whitespace before id', '<script data-x="1"id="__NEXT_DATA__">'],
	['next root div', '<div class="a" id="__next"></div>'],
	['next root div across a closing bracket', '<div class="a">x id="__next"'],
	['next url pattern', '<script src="/_next/static/a.js"></script>'],
	[
		'next url pattern uppercase is not matched',
		'<script src="/_NEXT/static/a.js"></script>',
	],
	['astro island', '<astro-island uid="1"></astro-island>'],
	['astro island uppercase', '<ASTRO-ISLAND>'],
	['astro island prefix of a longer name', '<astro-islands>'],
	['astro island followed by hyphen', '<astro-island-x>'],
	['astro url pattern', '<link href="/_astro/a.css">'],
	['astro scoped attribute', '<div data-astro-cid-abc123></div>'],
	['astro scoped attribute uppercase', '<div DATA-ASTRO-CID-ABC123></div>'],
	['vue scoped attribute 6', '<div data-v-abcdef></div>'],
	['vue scoped attribute 10', '<div data-v-abcdef1234></div>'],
	['vue scoped attribute 11 is not matched', '<div data-v-abcdef12345></div>'],
	['vue scoped attribute 5 is not matched', '<div data-v-abcde></div>'],
	['vue scoped attribute followed by hyphen', '<div data-v-abcdef12-x></div>'],
	[
		'vue scoped attribute followed by underscore is not matched',
		'<div data-v-abcdef_x></div>',
	],
	['vue app root', '<div id="app"></div>'],
	['vue app root after a tab', '<div\tid="app"></div>'],
	['vue app root after a no-break space', '<div id="app"></div>'],
	['vue app root after a byte order mark', '<div﻿id="app"></div>'],
	['vue app root after an ideographic space', '<div　id="app"></div>'],
	['vue app root after a line separator', '<div id="app"></div>'],
	['vue app root after next line is not matched', '<div\u0085id="app"></div>'],
	['vue app root after zero width space is not matched', '<div​id="app"></div>'],
	['vue license banner', '<script>/*!\n * Vue.js v3.4.21\n */</script>'],
	['vue license banner compact', '/*!*Vue.js v2'],
	['vue license banner uppercase', '/*! * VUE.JS V3'],
	['vue license banner without digit is not matched', '/*! * Vue.js vX'],
	['nuxt root div', '<div id="__nuxt"></div>'],
	['nuxt url pattern', '<script src="/_nuxt/a.js"></script>'],
	['svelte class', '<p class="title svelte-1a2b3c">x</p>'],
	['svelte class 9 is not matched', '<p class="svelte-1a2b3c4d5">x</p>'],
	['svelte class inside a word is not matched', '<p class="_svelte-1a2b3c">x</p>'],
	['sveltekit url pattern', '<link href="/_app/immutable/a.js">'],
	['remix context', '<script>window.__remixContext = {};</script>'],
	['remix context without spaces', 'window.__remixContext={}'],
	['remix context with a byte order mark', 'window.__remixContext﻿=1'],
	['gatsby root div', '<div id="___gatsby"></div>'],
	['gatsby url pattern', '<link href="/page-data/app-data.json">'],
	['angular version', '<app-root ng-version="17.0.1"></app-root>'],
	['angular version empty is not matched', '<app-root ng-version=""></app-root>'],
	['angular content attribute', '<p _ngcontent-ng-c123></p>'],
	['angular content attribute uppercase', '<p _NGCONTENT-NG-C123></p>'],
	['url patterns sharing a slash', '<script src="/_next/_astro/_nuxt/a.js"></script>'],
	['literal without its pattern', '<p>id="__next" data-v- svelte-</p>'],
	['first match is the evidence', '<p data-v-aaaaaa1></p><p data-v-bbbbbb2></p>'],
	[
		'every framework at once',
		'<div id="__next"></div><astro-island></astro-island><div data-v-abcdef></div><div id="__nuxt"></div><p class="svelte-abcdef"></p><div id="___gatsby"></div><app-root ng-version="1"></app-root><script src="/_next/a.js"></script>',
	],
	['evidence longer than 200 characters', `<div ${LONG} id="__next">`],
	[
		'evidence of 200 characters with a non-bmp character',
		`<div ${'😀'.repeat(120)} id="__next">`,
	],
	['evidence cut between a surrogate pair', `<div ${'x'.repeat(194)}😀 id="__next">`],
	['evidence with non-ascii text', '<div title="日本語" id="__next">'],
	['lone surrogate in the evidence', '<div title="\uD800" id="__next">'],
	['long s does not fold into an ascii letter', '<ASTRO-IſLAND>'],
	['kelvin sign does not fold into an ascii letter', '<div data-v-\u212A1b2c3d>'],
];

const output = process.argv[2] ?? defaultOutput;
const cases = EXAMPLES.map(([name, html]) => ({
	name,
	utf8Hex: Buffer.from(html, 'utf8').toString('hex'),
	signals: matchStructuralSignalsInJavaScript(html, STRUCTURAL_SIGNAL_DEFINITIONS),
}));
writeFileSync(output, `${JSON.stringify(cases, null, '\t')}\n`);
console.log(`wrote ${cases.length} cases`);
