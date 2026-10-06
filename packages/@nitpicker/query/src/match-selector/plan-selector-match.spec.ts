import { describe, expect, it } from 'vitest';

import { compileSelector } from './compile-selector.js';
import { planSelectorMatch } from './plan-selector-match.js';

/**
 * Plans a selector list.
 * @param selector - The selector.
 */
function plan(selector: string) {
	return planSelectorMatch(compileSelector(selector));
}

describe('planSelectorMatch', () => {
	it('sends a single compound to the regular expression only', () => {
		const { directRegExp, tokenizedAlternatives, allAlternatives } = plan('img[alt]');
		expect(directRegExp).toBeInstanceOf(RegExp);
		expect(tokenizedAlternatives).toHaveLength(0);
		expect(allAlternatives).toHaveLength(1);
	});

	it('keeps the literals of every alternative the regular expression covers', () => {
		const { directPrefilterLiterals } = plan('img[alt], #main, *');
		expect(directPrefilterLiterals).toEqual([['<img'], ['main'], null]);
	});

	it('sends a chain to the open-element stack only', () => {
		const { directRegExp, tokenizedAlternatives } = plan('nav a');
		expect(directRegExp).toBeNull();
		expect(tokenizedAlternatives).toHaveLength(1);
		expect(tokenizedAlternatives[0]!.prefilterLiterals).toEqual(['<nav', '<a']);
	});

	it('splits a list between the layers', () => {
		const { directRegExp, tokenizedAlternatives, allAlternatives } =
			plan('img, nav a, video');
		expect(directRegExp).toBeInstanceOf(RegExp);
		expect(tokenizedAlternatives).toHaveLength(1);
		expect(allAlternatives).toHaveLength(3);
	});

	it.each([
		['li:first-child'],
		['li:nth-child(2)'],
		['li:not(:first-child)'],
		['a[title="x>y"]'],
	])('sends %s to the open-element stack', (selector) => {
		const { directRegExp, tokenizedAlternatives } = plan(selector);
		expect(directRegExp).toBeNull();
		expect(tokenizedAlternatives).toHaveLength(1);
	});

	it('records which sibling positions are needed', () => {
		expect(plan('a')).toMatchObject({ needsChildIndex: false, needsTypeIndex: false });
		expect(plan('li:first-child')).toMatchObject({
			needsChildIndex: true,
			needsTypeIndex: false,
		});
		expect(plan('li:nth-of-type(2)')).toMatchObject({
			needsChildIndex: false,
			needsTypeIndex: true,
		});
		expect(plan('a:not(:first-child), b:first-of-type')).toMatchObject({
			needsChildIndex: true,
			needsTypeIndex: true,
		});
	});
});
