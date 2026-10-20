import type { SelectorAlternative, SelectorPlan } from './types.js';

import { describe, it, expect } from 'vitest';

import { matchSelectorHtml } from './match-selector-html.js';

/**
 * A plan with one alternative.
 * @param alternative - The alternative.
 * @param indexes - Which sibling positions the alternative tests.
 * @param indexes.child - Whether it tests `:nth-child`.
 * @param indexes.ofType - Whether it tests `:nth-of-type`.
 */
function planOf(
	alternative: SelectorAlternative,
	indexes: { child?: boolean; ofType?: boolean } = {},
): SelectorPlan {
	return {
		alternatives: [alternative],
		needsChildIndex: indexes.child ?? false,
		needsTypeIndex: indexes.ofType ?? false,
	};
}

/**
 * A compound that tests a tag only.
 * @param tag - The lower-cased tag name.
 * @param tagName
 */
function tag(tagName: string) {
	return { tag: tagName, attributes: [], nth: [], negations: [] };
}

const IMG: SelectorAlternative = {
	compounds: [tag('img')],
	combinators: [],
	prefilterLiterals: ['<img'],
	direct: true,
};

const NAV_CHILD_A: SelectorAlternative = {
	compounds: [tag('nav'), tag('a')],
	combinators: ['child'],
	prefilterLiterals: ['<nav', '<a'],
	direct: false,
};

describe('matchSelectorHtml', () => {
	it('matches a start tag that fits and reports it decided without the stack', () => {
		expect(
			matchSelectorHtml({ plan: planOf(IMG), html: '<p><img src="a"></p>' }),
		).toEqual({
			matched: true,
			prefiltered: false,
			tokenized: false,
			elementsVisited: 0,
		});
	});

	it('reports a document that lacks the literals as prefiltered', () => {
		expect(matchSelectorHtml({ plan: planOf(IMG), html: '<p>x</p>' })).toEqual({
			matched: false,
			prefiltered: true,
			tokenized: false,
			elementsVisited: 0,
		});
	});

	it('runs the open-element stack for a combinator and counts the elements it tested', () => {
		expect(
			matchSelectorHtml({
				plan: planOf(NAV_CHILD_A),
				html: '<nav><a href="/"></a></nav>',
			}),
		).toEqual({ matched: true, prefiltered: false, tokenized: true, elementsVisited: 2 });
		expect(
			matchSelectorHtml({
				plan: planOf(NAV_CHILD_A),
				html: '<nav><ul><a href="/"></a></ul></nav>',
			}).matched,
		).toBe(false);
	});

	it('accepts the document as UTF-8 bytes', () => {
		const html = new TextEncoder().encode('<p title="日本語"><img></p>');
		expect(matchSelectorHtml({ plan: planOf(IMG), html }).matched).toBe(true);
	});

	it('does not read tag-like text in comments, raw text elements or quoted values', () => {
		const html =
			'<!-- <img> --><script>"<img>"</script><a title="<img>">x</a><img-x></img-x>';
		expect(matchSelectorHtml({ plan: planOf(IMG), html }).matched).toBe(false);
	});

	it('does not search inside a template', () => {
		const html = '<template><img></template>';
		const outcome = matchSelectorHtml({ plan: planOf(IMG), html });
		expect(outcome.matched).toBe(false);
		expect(outcome.tokenized).toBe(true);
	});

	it('counts sibling positions when the plan asks for them', () => {
		const secondLi: SelectorAlternative = {
			compounds: [
				{
					tag: 'li',
					attributes: [],
					nth: [{ kind: 'child', a: 0, b: 2 }],
					negations: [],
				},
			],
			combinators: [],
			prefilterLiterals: ['<li'],
			direct: false,
		};
		expect(
			matchSelectorHtml({
				plan: planOf(secondLi, { child: true }),
				html: '<ul><li></li><li></li></ul>',
			}).matched,
		).toBe(true);
		expect(
			matchSelectorHtml({
				plan: planOf(secondLi, { child: true }),
				html: '<ul><li></li></ul><ul><li></li></ul>',
			}).matched,
		).toBe(false);
	});

	it('ignores ASCII case in names and folds nothing else', () => {
		const link: SelectorAlternative = {
			compounds: [tag('link')],
			combinators: [],
			prefilterLiterals: null,
			direct: true,
		};
		expect(matchSelectorHtml({ plan: planOf(link), html: '<LINK rel=a>' }).matched).toBe(
			true,
		);
		// U+212A KELVIN SIGN is not an ASCII `K`.
		expect(matchSelectorHtml({ plan: planOf(link), html: '<linK>' }).matched).toBe(false);
	});

	it('reads invalid UTF-8 as replacement characters, as a batch does', () => {
		const alternative: SelectorAlternative = {
			compounds: [
				{
					tag: 'p',
					attributes: [
						{ name: 'title', operator: 'equals', value: '��', ignoreCase: false },
					],
					nth: [],
					negations: [],
				},
			],
			combinators: [],
			prefilterLiterals: ['<p'],
			direct: true,
		};
		const html = Buffer.concat([
			Buffer.from('<p title="'),
			Buffer.from([255, 254]),
			Buffer.from('">'),
		]);
		expect(matchSelectorHtml({ plan: planOf(alternative), html }).matched).toBe(true);
	});

	it('throws InvalidArg for a malformed plan', () => {
		const bad = { ...IMG, combinators: ['child'] } as const;
		expect(() => matchSelectorHtml({ plan: planOf(bad), html: '<img>' })).toThrow(
			expect.objectContaining({ code: 'InvalidArg' }),
		);
		const badOperator = {
			...IMG,
			compounds: [
				{
					tag: 'img',
					attributes: [
						{ name: 'alt', operator: 'matches' as never, value: '', ignoreCase: false },
					],
					nth: [],
					negations: [],
				},
			],
		};
		expect(() => matchSelectorHtml({ plan: planOf(badOperator), html: '<img>' })).toThrow(
			expect.objectContaining({ code: 'InvalidArg' }),
		);
	});

	describe('rejects a plan the matcher cannot evaluate', () => {
		const chainOf = (length: number): SelectorAlternative => ({
			compounds: Array.from({ length }, () => tag('a')),
			combinators: Array.from(
				{ length: Math.max(length - 1, 0) },
				() => 'child' as const,
			),
			prefilterLiterals: null,
			direct: false,
		});

		it('accepts a chain of 1 and of 30 compounds', () => {
			expect(matchSelectorHtml({ plan: planOf(chainOf(1)), html: '<a>' }).matched).toBe(
				true,
			);
			expect(matchSelectorHtml({ plan: planOf(chainOf(30)), html: '<a>' }).matched).toBe(
				false,
			);
		});

		it.each([[0], [31]])('a chain of %i compounds', (length) => {
			expect(() =>
				matchSelectorHtml({ plan: planOf(chainOf(length)), html: '<a>' }),
			).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
		});

		it('an unknown combinator name', () => {
			const alternative = {
				...chainOf(2),
				combinators: ['sibling'] as unknown as readonly 'child'[],
			};
			expect(() => matchSelectorHtml({ plan: planOf(alternative), html: '<a>' })).toThrow(
				expect.objectContaining({ code: 'InvalidArg' }),
			);
		});

		it('an unknown position test kind', () => {
			const alternative: SelectorAlternative = {
				...chainOf(1),
				compounds: [{ ...tag('a'), nth: [{ kind: 'last' as never, a: 0, b: 1 }] }],
			};
			expect(() => matchSelectorHtml({ plan: planOf(alternative), html: '<a>' })).toThrow(
				expect.objectContaining({ code: 'InvalidArg' }),
			);
		});

		it('a direct alternative with a combinator chain or a position test', () => {
			const chained = { ...chainOf(2), direct: true };
			expect(() => matchSelectorHtml({ plan: planOf(chained), html: '<a>' })).toThrow(
				expect.objectContaining({ code: 'InvalidArg' }),
			);
			const positioned: SelectorAlternative = {
				...chainOf(1),
				direct: true,
				compounds: [{ ...tag('a'), nth: [{ kind: 'child', a: 0, b: 1 }] }],
			};
			expect(() => matchSelectorHtml({ plan: planOf(positioned), html: '<a>' })).toThrow(
				expect.objectContaining({ code: 'InvalidArg' }),
			);
		});
	});
});
