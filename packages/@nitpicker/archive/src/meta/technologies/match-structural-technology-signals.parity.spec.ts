/**
 * Pins the native structural matcher (`@nitpicker/core`'s
 * `crates/nitpicker_tech_detect`) to the JavaScript regular expressions in
 * `structural-signal-definitions.ts`, run by
 * `match-structural-signals-in-javascript.ts` — both kept only as the
 * oracle. The `technology_signals` rows of existing archives were computed by
 * those expressions, so any divergence would make the same page report
 * different evidence, or a different set of signals, across old and new
 * crawls.
 */
import type { TechnologySignalPartial } from './types.js';

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { matchJsLicenseCommentSignal } from './match-js-license-comment-signal.js';
import { matchStructuralSignalsInJavaScript } from './match-structural-signals-in-javascript.js';
import { matchStructuralTechnologySignals } from './match-structural-technology-signals.js';
import { STRUCTURAL_SIGNAL_DEFINITIONS } from './structural-signal-definitions.js';

interface GoldenCase {
	readonly name: string;
	readonly utf8Hex: string;
	readonly signals: readonly TechnologySignalPartial[];
}

/**
 * The oracle over every definition, or over the given subset.
 * @param text - HTML, or a JS resource's leading text.
 * @param definitions - The definitions to test.
 * @returns One signal per matching definition.
 */
function matchInJavaScript(
	text: string,
	definitions = STRUCTURAL_SIGNAL_DEFINITIONS,
): TechnologySignalPartial[] {
	return matchStructuralSignalsInJavaScript(text, definitions);
}

const golden = JSON.parse(
	readFileSync(
		new URL(
			'../../../../core/crates/nitpicker_tech_detect/tests/fixtures/technology-signals-golden.json',
			import.meta.url,
		),
		'utf8',
	),
) as GoldenCase[];

/**
 * Fragments biased toward the patterns' edges: every fingerprint's literal
 * in both cases, the quoting and `>` that bound `[^>]*` / `[^"]*`, the
 * boundaries of the counted classes, JS `\s` members outside ASCII (and
 * near misses that are not), code points that fold to ASCII under Unicode
 * case-insensitivity, astral characters and lone surrogates.
 */
const FRAGMENTS = [
	'<script',
	'<SCRIPT',
	'<div',
	'<DIV',
	' id="__NEXT_DATA__"',
	' id="__next"',
	' id="__nuxt"',
	' id="___gatsby"',
	' id="app"',
	' ID="APP"',
	'id="app"',
	'/_next/',
	'/_NEXT/',
	'/_astro/',
	'/_nuxt/',
	'_astro/',
	'_next/',
	'/_app/immutable/',
	'/page-data/',
	'<astro-island',
	'<ASTRO-ISLAND',
	' data-astro-cid-',
	' data-v-',
	' DATA-V-',
	'class="',
	'svelte-',
	'SVELTE-',
	' ng-version="',
	' _ngcontent-',
	'window.__remixContext',
	'=',
	'/*!',
	'*',
	'Vue.js v',
	'VUE.JS V',
	'1.2',
	'abc123',
	'abcdef12',
	'a1b2c3d4e5f6',
	'-',
	'_',
	'"',
	'>',
	' ',
	'\t',
	'\n',
	'\u000B',
	' ',
	'\u0085',
	' ',
	' ',
	'​',
	' ',
	' ',
	' ',
	'　',
	'﻿',
	'ſ',
	'K',
	'İ',
	'日本',
	'😀',
	'\uD800',
	'\uDC00',
	'x'.repeat(90),
];

/**
 * Deterministic PRNG (mulberry32) so a failure reproduces from its seed.
 * @param seed - 32-bit seed.
 * @returns A function yielding floats in [0, 1).
 */
function createRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		// mulberry32's increment 0x6D2B79F5, in decimal: lint autofix and the
		// check mode disagree on hex literal casing.
		state = (state + 1_831_565_813) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/**
 * Joins random fragments into one input.
 * @param random - The PRNG.
 * @returns The input text.
 */
function randomText(random: () => number): string {
	const length = 1 + Math.floor(random() * 24);
	let text = '';
	for (let j = 0; j < length; j++) {
		text += FRAGMENTS[Math.floor(random() * FRAGMENTS.length)];
	}
	return text;
}

describe('structural technology detection parity with the JavaScript implementation', () => {
	it.each(golden.map((c) => [c.name, c] as const))(
		'the JavaScript expressions produce the golden signals: %s',
		(_name, goldenCase) => {
			// Decoding the hex turns the lone-surrogate cases into U+FFFD, so the
			// oracle sees that form here; lone surrogates themselves go through
			// both implementations in the random parity test below.
			const html = Buffer.from(goldenCase.utf8Hex, 'hex').toString('utf8');
			expect(matchInJavaScript(html)).toEqual(goldenCase.signals);
		},
	);

	it('matches the JavaScript implementation on 5,000 random fragment mixes', () => {
		const random = createRandom(430);
		for (let i = 0; i < 5000; i++) {
			const html = randomText(random);
			expect(matchStructuralTechnologySignals(html, null), JSON.stringify(html)).toEqual(
				matchInJavaScript(html),
			);
		}
	});

	it('matches the JavaScript JS-resource scan on 5,000 random fragment mixes', () => {
		const licenseDefinitions = STRUCTURAL_SIGNAL_DEFINITIONS.filter(
			(def) => def.signalType === 'js-license-comment',
		);
		const random = createRandom(4300);
		for (let i = 0; i < 5000; i++) {
			const script = randomText(random);
			expect(
				matchJsLicenseCommentSignal(Buffer.from(script, 'utf8')),
				JSON.stringify(script),
			).toEqual(matchInJavaScript(script, licenseDefinitions)[0] ?? null);
		}
	});
});
