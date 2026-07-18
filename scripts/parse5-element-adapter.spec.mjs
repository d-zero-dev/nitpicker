import { parse } from 'parse5';
import { describe, it, expect } from 'vitest';

import { deriveDomPath } from '../packages/@nitpicker/crawler/lib/archive/populate-entity-tables/derive-dom-path.js';

import { findElementsByTagName } from './find-elements-by-tag-name.mjs';
import { Parse5ElementAdapter } from './parse5-element-adapter.mjs';

/**
 * Parses `html` and returns the first `<tagName>` element wrapped in
 * {@link Parse5ElementAdapter}.
 * @param {string} html
 * @param {string} tagName
 */
function firstWrapped(html, tagName) {
	const document = parse(html);
	const [node] = findElementsByTagName(document, tagName);
	if (node === undefined) {
		throw new Error(`fixture has no <${tagName}>: ${html}`);
	}
	return new Parse5ElementAdapter(node);
}

describe('Parse5ElementAdapter', () => {
	it('exposes the lower-cased tag name', () => {
		const img = firstWrapped('<!doctype html><html><body><IMG></body></html>', 'img');
		expect(img.tagName).toBe('img');
	});

	it('walks parentElement up to html, matching deriveDomPath output for a top-level image', () => {
		const img = firstWrapped('<!doctype html><html><body><img></body></html>', 'img');
		expect(deriveDomPath(img)).toBe('html/body[1]/img[1]');
	});

	it('counts same-tag siblings via previousElementSibling with a 1-based ordinal', () => {
		const document = parse(
			'<!doctype html><html><body><img><img><img id="target"></body></html>',
		);
		const target = findElementsByTagName(document, 'img')[2];
		expect(deriveDomPath(new Parse5ElementAdapter(target))).toBe('html/body[1]/img[3]');
	});

	it('ignores non-element siblings (text nodes) when counting ordinals', () => {
		const document = parse(
			'<!doctype html><html><body><img>text between<img id="target"></body></html>',
		);
		const [, target] = findElementsByTagName(document, 'img');
		expect(deriveDomPath(new Parse5ElementAdapter(target))).toBe('html/body[1]/img[2]');
	});

	it('nests ancestor tags with per-tag sibling ordinals', () => {
		const img = firstWrapped(
			'<!doctype html><html><body><main><section></section><section><picture><img></picture></section></main></body></html>',
			'img',
		);
		expect(deriveDomPath(img)).toBe('html/body[1]/main[1]/section[2]/picture[1]/img[1]');
	});

	it('returns null from parentElement/previousElementSibling for <html> itself', () => {
		const document = parse('<!doctype html><html><body></body></html>');
		const [html] = findElementsByTagName(document, 'html');
		const wrapped = new Parse5ElementAdapter(html);
		expect(wrapped.previousElementSibling).toBeNull();
	});
});
