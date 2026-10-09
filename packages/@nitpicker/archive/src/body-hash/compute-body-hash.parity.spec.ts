/**
 * Pins the native `computeBodyHash` to the JavaScript implementation it
 * replaced, which stays in this directory (`extract-body.ts`,
 * `normalize-url-like-strings.ts`, `mask-dynamic-ids.ts`) only as the oracle
 * for this spec. `page_meta.body_hash` values in existing archives were
 * written by that implementation, so any divergence would silently break
 * duplicate detection and Tier-B alias matching across old and new crawls.
 */
import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { computeContentHash } from '../populate-ref-tables/compute-content-hash.js';

import { computeBodyHash } from './compute-body-hash.js';
import { extractBody } from './extract-body.js';
import { maskDynamicIds } from './mask-dynamic-ids.js';
import { normalizeUrlLikeStrings } from './normalize-url-like-strings.js';

interface GoldenCase {
	readonly name: string;
	readonly utf8Hex: string;
	readonly hash: string;
}

/**
 * The staged JavaScript pipeline, exactly as `computeBodyHash` ran it before
 * moving to the native addon.
 * @param html - HTML document string.
 * @returns The 32-byte hash.
 */
function computeBodyHashInJavaScript(html: string): Buffer {
	return computeContentHash(maskDynamicIds(normalizeUrlLikeStrings(extractBody(html))));
}

const golden = JSON.parse(
	readFileSync(
		new URL(
			'../../../core/crates/nitpicker_html_scan/tests/fixtures/body-hash-golden.json',
			import.meta.url,
		),
		'utf8',
	),
) as GoldenCase[];

/**
 * Fragments biased toward the patterns' edges: tag and suffix spellings,
 * quoting, token boundaries, and code points that fold to ASCII under
 * Unicode case-insensitivity (U+017F, U+212A, U+0130) or have no UTF-8 form
 * (lone surrogates).
 */
const FRAGMENTS = [
	'<body',
	'<BODY',
	'<bodyguard',
	'>',
	'</body>',
	'</BoDy>',
	'</body',
	' class="a>b"',
	" data-x='>'",
	'"',
	"'",
	'/index.',
	'/INDEX.',
	'/index',
	'html',
	'php?x=1',
	'_',
	'a1b2c3d4',
	'ABCDEFGH',
	'12345678',
	'abc',
	'123',
	'x9',
	'Z',
	'0',
	' ',
	'\n',
	'ſ',
	'K',
	'İ',
	'日本',
	'😀',
	'\uD800',
	'\uDC00',
	'ａ１',
];

/**
 * Deterministic PRNG (mulberry32) so a failure reproduces from its seed.
 * @param seed - 32-bit seed.
 * @returns A function yielding floats in [0, 1).
 */
function createRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d_2b_79_f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

describe('computeBodyHash parity with the JavaScript implementation', () => {
	it.each(golden.map((c) => [c.name, c] as const))(
		'the JavaScript implementation still produces the golden hash: %s',
		(_name, goldenCase) => {
			const html = Buffer.from(goldenCase.utf8Hex, 'hex').toString('utf8');
			expect(computeBodyHashInJavaScript(html).toString('hex')).toBe(goldenCase.hash);
		},
	);

	it('matches the JavaScript implementation on 2,000 random fragment mixes', () => {
		const random = createRandom(425);
		for (let i = 0; i < 2000; i++) {
			const length = 1 + Math.floor(random() * 24);
			let html = '';
			for (let j = 0; j < length; j++) {
				html += FRAGMENTS[Math.floor(random() * FRAGMENTS.length)];
			}
			expect(computeBodyHash(html).toString('hex'), JSON.stringify(html)).toBe(
				computeBodyHashInJavaScript(html).toString('hex'),
			);
		}
	});
});
