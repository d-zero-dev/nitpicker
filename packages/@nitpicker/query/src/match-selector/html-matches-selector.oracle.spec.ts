import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { matchHtmlWithTokenizer } from './test-helpers/match-html-with-tokenizer.js';
import { matchHtml } from './test-helpers/match-html.js';

/**
 * The ground truth for these tests is `querySelector` on the DOM *before*
 * it is serialized. Re-parsing the serialized string with an HTML parser
 * would not do: it rebuilds the tree (`<p><div></div></p>` becomes two
 * siblings), so a correct engine would disagree with it.
 */

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Creates an empty HTML document to build a DOM in.
 */
function createDocument(): Document {
	return new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>').window
		.document;
}

/**
 * Creates an element with attributes and children through DOM calls.
 * @param document - The DOM document.
 * @param name - The tag name.
 * @param attributes - The attributes to set.
 * @param children - Child nodes or text.
 */
function element(
	document: Document,
	name: string,
	attributes: Record<string, string> = {},
	...children: (Node | string)[]
): HTMLElement {
	const created = document.createElement(name);
	for (const [key, value] of Object.entries(attributes)) {
		created.setAttribute(key, value);
	}
	for (const child of children) {
		created.append(child);
	}
	return created;
}

/**
 * Asserts that the engine agrees with the DOM about every selector.
 * @param document - The DOM document.
 * @param selectors - The selectors to check.
 */
function expectAgreement(document: Document, selectors: string[]) {
	const html = document.documentElement.outerHTML;
	for (const selector of selectors) {
		const oracle = document.querySelector(selector) !== null;
		expect(matchHtml(selector, html).matched, `${selector} on ${html}`).toBe(oracle);
		expect(
			matchHtmlWithTokenizer(selector, html).matched,
			`stack: ${selector} on ${html}`,
		).toBe(oracle);
	}
}

/**
 * Asserts that the DOM answers the expected verdict for every selector and that the engine
 * agrees, so a case cannot pass by agreeing on the wrong verdict.
 * @param document - The DOM document.
 * @param selectors - The selectors to check.
 * @param expected - The expected verdicts.
 */
function expectKnownVerdicts(
	document: Document,
	selectors: string[],
	expected: boolean[],
) {
	const html = document.documentElement.outerHTML;
	for (const [index, selector] of selectors.entries()) {
		expect(document.querySelector(selector) !== null, `DOM for ${selector}`).toBe(
			expected[index],
		);
		expect(matchHtml(selector, html).matched, `${selector} on ${html}`).toBe(
			expected[index],
		);
	}
}

describe('htmlMatchesSelector against the DOM it was serialized from', () => {
	it('matches p > div built by DOM calls, which re-parsing would split', () => {
		const document = createDocument();
		document.body.append(element(document, 'p', {}, element(document, 'div')));
		expectKnownVerdicts(
			document,
			['p > div', 'p div', 'div > p', 'body > p'],
			[true, true, false, true],
		);
	});

	it('does not search <template> content, nested or not', () => {
		const document = createDocument();
		const outer = document.createElement('template');
		const inner = document.createElement('template');
		inner.content.append(element(document, 'img'));
		outer.content.append(inner, element(document, 'b'));
		document.body.append(outer, element(document, 'i'));
		expectKnownVerdicts(
			document,
			['img', 'b', 'i', 'template', 'body > template', 'body i'],
			[false, false, true, true, true, true],
		);
	});

	it('does not search the text of a noscript parsed with scripting enabled', () => {
		const document = createDocument();
		const noscript = element(document, 'noscript');
		noscript.textContent = '<img><p class="a"></p>';
		document.body.append(noscript, element(document, 'b'));
		expectKnownVerdicts(
			document,
			['img', 'p.a', 'noscript', 'b', 'body > b'],
			[false, false, true, true, true],
		);
	});

	it('does not search script, style or comment text', () => {
		const document = createDocument();
		const script = element(document, 'script', { src: '/a.js' });
		script.textContent = 'var s = "<img>";';
		const style = element(document, 'style');
		style.textContent = 'a::after{content:"<p>"}';
		document.body.append(
			script,
			style,
			document.createComment(' <img> '),
			element(document, 'b'),
		);
		expectKnownVerdicts(
			document,
			['img', 'p', 'script[src]', 'style', 'b', 'body > script'],
			[false, false, true, true, true, true],
		);
	});

	// `[attr~=v]` treats only ASCII whitespace as a separator, as browsers do.
	// jsdom's selector engine also splits on U+00A0, so that one case is pinned
	// in the fixed table of `html-matches-selector.spec.ts` instead of here.
	it('compares attribute values containing &, quotes and no-break spaces', () => {
		const document = createDocument();
		document.body.append(
			element(document, 'a', { href: '/?a=1&b=2', title: 'say "hi" & bye\u00A0now' }),
			element(document, 'a', { href: '/x&amp;y', title: '&amp;' }),
		);
		expectAgreement(document, [
			'[href="/?a=1&b=2"]',
			'[href="/?a=1&amp;b=2"]',
			'[href*="&amp;"]',
			'[href$="y"]',
			'[title*=amp]',
			'[title*="&"]',
			'[title$=";"]',
			'[title="&amp;"]',
			'[title^="say"]',
			'[title*="\u00A0now"]',
			String.raw`[title*="\"hi\""]`,
			'[title~="&"]',
		]);
	});

	it('compares the attributes HTML defines as case-insensitive without an i flag', () => {
		const document = createDocument();
		document.body.append(
			element(document, 'input', { type: 'TEXT', 'data-type': 'TEXT' }),
			element(document, 'a', { rel: 'NoFollow noopener', hreflang: 'EN-us' }),
		);
		expectKnownVerdicts(
			document,
			[
				'input[type=text]',
				'input[type="text" s]',
				'input[data-type=text]',
				'a[rel~=nofollow]',
				'a[hreflang|=en]',
				'a[hreflang="EN-us" s]',
			],
			[true, false, false, true, true, true],
		);
	});

	it('matches SVG elements and attributes by their serialized names', () => {
		const document = createDocument();
		const svg = document.createElementNS(SVG, 'svg');
		svg.setAttribute('viewBox', '0 0 1 1');
		svg.append(document.createElementNS(SVG, 'foreignObject'));
		document.body.append(svg);
		expectAgreement(document, [
			'svg[viewBox]',
			'foreignObject',
			'svg > foreignObject',
			'body svg',
		]);
	});

	it('counts sibling positions the way the DOM does', () => {
		const document = createDocument();
		const list = element(
			document,
			'ul',
			{},
			'text',
			element(document, 'li', { class: 'a' }),
			document.createComment('c'),
			element(document, 'b'),
			element(document, 'li'),
			element(document, 'li', { class: 'z' }),
		);
		document.body.append(list, element(document, 'ul', {}, element(document, 'li')));
		expectAgreement(document, [
			'li:first-child',
			'li:nth-child(2)',
			'li:nth-child(3)',
			'li:nth-child(4)',
			'li:nth-of-type(2)',
			'li:nth-of-type(3)',
			'li:nth-of-type(4)',
			'li:nth-of-type(2n+1)',
			'li:nth-child(-n+2)',
			'b:first-of-type',
			'li:not(.a):not(.z)',
			'ul > li.z:nth-child(5)',
		]);
	});

	describe('randomly generated trees and selectors', () => {
		const TAGS = ['div', 'p', 'span', 'ul', 'li', 'a', 'section', 'img'];
		const CLASSES = ['a', 'b', 'c'];

		/**
		 * Creates a small deterministic random generator (a linear congruential generator) so a failure reproduces.
		 * @param seed - The seed of the sequence.
		 */
		function createRandom(seed: number) {
			let state = seed >>> 0;
			return (bound: number) => {
				state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
				return (state >>> 8) % bound;
			};
		}

		/**
		 * Builds a random element tree.
		 * @param document - The DOM document.
		 * @param random - The random generator.
		 * @param depth - The maximum nesting depth.
		 */
		function buildTree(
			document: Document,
			random: (n: number) => number,
			depth: number,
		): HTMLElement {
			const name = TAGS[random(TAGS.length)]!;
			const attributes: Record<string, string> = {};
			if (random(2) === 0) {
				attributes.class = CLASSES.filter(() => random(2) === 0).join(' ');
			}
			if (random(4) === 0) {
				attributes['data-k'] = ['x', 'xy', 'y&z'][random(3)]!;
			}
			const created = element(document, name, attributes);
			if (name !== 'img' && depth > 0) {
				for (let i = random(4); i > 0; i--) {
					created.append(buildTree(document, random, depth - 1));
					if (random(5) === 0) {
						created.append('text');
					}
				}
			}
			return created;
		}

		/**
		 * Builds a random selector from the supported grammar.
		 * @param random - The random generator.
		 */
		function buildSelector(random: (n: number) => number): string {
			const compound = () => {
				const parts: string[] = [];
				if (random(2) === 0) {
					parts.push(TAGS[random(TAGS.length)]!);
				}
				if (random(3) === 0) {
					parts.push(`.${CLASSES[random(CLASSES.length)]}`);
				}
				if (random(6) === 0) {
					parts.push(
						['[data-k]', '[data-k=x]', '[data-k^=x]', '[data-k*="&"]'][random(4)]!,
					);
				}
				if (random(6) === 0) {
					parts.push(
						[
							':first-child',
							':nth-child(2)',
							':nth-of-type(2n+1)',
							':first-of-type',
							':not(.a)',
						][random(5)]!,
					);
				}
				return parts.length > 0 ? parts.join('') : '*';
			};
			const chain = [compound()];
			for (let i = random(3); i > 0; i--) {
				chain.push(random(2) === 0 ? '>' : ' ', compound());
			}
			const text = chain.join(chain.length > 1 ? ' ' : '');
			return random(5) === 0 ? `${text}, ${compound()}` : text;
		}

		it('agrees with querySelector on 300 random pairs', () => {
			const random = createRandom(20_260_706);
			let positives = 0;
			for (let round = 0; round < 300; round++) {
				const document = createDocument();
				document.body.append(
					buildTree(document, random, 4),
					buildTree(document, random, 3),
				);
				const selector = buildSelector(random);
				const html = document.documentElement.outerHTML;
				const oracle = document.querySelector(selector) !== null;
				expect(matchHtml(selector, html).matched, `${selector} on ${html}`).toBe(oracle);
				expect(
					matchHtmlWithTokenizer(selector, html).matched,
					`stack: ${selector} on ${html}`,
				).toBe(oracle);
				positives += oracle ? 1 : 0;
			}
			// the comparison is only meaningful if many selectors really match
			expect(positives).toBeGreaterThan(30);
		});
	});
});
