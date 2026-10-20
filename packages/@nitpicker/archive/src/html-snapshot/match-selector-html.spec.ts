import type { SelectorPlan } from './types.js';

import { describe, it, expect } from 'vitest';

import { matchSelectorHtml } from './match-selector-html.js';

const NAV_CHILD_A: SelectorPlan = {
	alternatives: [
		{
			compounds: [
				{ tag: 'nav', attributes: [], nth: [], negations: [] },
				{ tag: 'a', attributes: [], nth: [], negations: [] },
			],
			combinators: ['child'],
			prefilterLiterals: ['<nav', '<a'],
			direct: false,
		},
	],
	needsChildIndex: false,
	needsTypeIndex: false,
};

describe('matchSelectorHtml', () => {
	it('judges a document the native matcher reads as markup', () => {
		expect(
			matchSelectorHtml({ plan: NAV_CHILD_A, html: '<nav><a href="/">x</a></nav>' }),
		).toEqual({ matched: true, prefiltered: false, tokenized: true, elementsVisited: 2 });
	});

	it('reports a document without the literals as prefiltered', () => {
		expect(matchSelectorHtml({ plan: NAV_CHILD_A, html: '<p>x</p>' })).toEqual({
			matched: false,
			prefiltered: true,
			tokenized: false,
			elementsVisited: 0,
		});
	});

	it('accepts the document as UTF-8 bytes', () => {
		const html = new TextEncoder().encode('<nav><a>日本語</a></nav>');
		expect(matchSelectorHtml({ plan: NAV_CHILD_A, html }).matched).toBe(true);
	});
});
