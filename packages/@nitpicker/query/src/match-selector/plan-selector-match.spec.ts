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
	it('marks a single compound as decided by one start tag', () => {
		const { alternatives } = plan('img[alt]');
		expect(alternatives).toHaveLength(1);
		expect(alternatives[0]!.direct).toBe(true);
	});

	it('keeps the prefilter literals of every alternative', () => {
		const { alternatives } = plan('img[alt], #main, *');
		expect(alternatives.map((alternative) => alternative.prefilterLiterals)).toEqual([
			['<img'],
			['main'],
			null,
		]);
	});

	it('leaves a chain to the open-element stack', () => {
		const { alternatives } = plan('nav a');
		expect(alternatives[0]!.direct).toBe(false);
		expect(alternatives[0]!.prefilterLiterals).toEqual(['<nav', '<a']);
		expect(alternatives[0]!.combinators).toEqual(['descendant']);
	});

	it('splits a list between the stages', () => {
		const { alternatives } = plan('img, nav a, video');
		expect(alternatives.map((alternative) => alternative.direct)).toEqual([
			true,
			false,
			true,
		]);
	});

	it.each([
		['li:first-child'],
		['li:nth-child(2)'],
		['li:not(:first-child)'],
		['a[title="x>y"]'],
	])('leaves %s to the open-element stack', (selector) => {
		expect(plan(selector).alternatives[0]!.direct).toBe(false);
	});

	it('carries the compounds as the matcher reads them', () => {
		const { alternatives } = plan('a[href^="/p/" i]:not(.x)');
		expect(alternatives[0]!.compounds[0]).toMatchObject({
			tag: 'a',
			attributes: [{ name: 'href', operator: 'prefix', value: '/p/', ignoreCase: true }],
			negations: [{ tag: null }],
		});
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
