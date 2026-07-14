import { JSDOM } from 'jsdom';
import { describe, it, expect } from 'vitest';

import { deriveDomPath } from './derive-dom-path.js';

/**
 * Parses `html` and returns the first `<img>` element for path testing.
 * Kept as a helper so each `it` block reads as one assertion pair.
 * @param html - HTML source to parse.
 */
function firstImg(html: string): Element {
	const dom = new JSDOM(html);
	const img = dom.window.document.querySelector('img');
	if (img === null) {
		throw new Error(`fixture has no <img>: ${html}`);
	}
	return img;
}

describe('deriveDomPath (dom-path-derivation)', () => {
	it('produces a plain html/body[1]/img[1] path for a top-level image', () => {
		const img = firstImg('<!doctype html><html><body><img></body></html>');
		expect(deriveDomPath(img)).toBe('html/body[1]/img[1]');
	});

	it('counts same-tag siblings with a 1-based ordinal', () => {
		const dom = new JSDOM(
			'<!doctype html><html><body><img><img><img id="target"></body></html>',
		);
		const target = dom.window.document.querySelector('#target')!;
		expect(deriveDomPath(target)).toBe('html/body[1]/img[3]');
	});

	it('nests ancestor tags with per-tag sibling ordinals', () => {
		const dom = new JSDOM(
			'<!doctype html><html><body><main><section></section><section><picture><img></picture></section></main></body></html>',
		);
		const img = dom.window.document.querySelector('img')!;
		expect(deriveDomPath(img)).toBe('html/body[1]/main[1]/section[2]/picture[1]/img[1]');
	});

	it('ignores non-Element siblings when counting ordinals', () => {
		// Text nodes are Nodes but not Elements. The walk uses
		// `previousElementSibling`, so a text-node between two `<img>`
		// tags must NOT reset the ordinal.
		const dom = new JSDOM(
			'<!doctype html><html><body><img>text between<img id="target"></body></html>',
		);
		const target = dom.window.document.querySelector('#target')!;
		expect(deriveDomPath(target)).toBe('html/body[1]/img[2]');
	});

	it('handles a detached element by falling back to the traversed prefix', () => {
		const dom = new JSDOM('<!doctype html><html><body></body></html>');
		const detached = dom.window.document.createElement('img');
		expect(deriveDomPath(detached)).toBe('img[1]');
	});
});
