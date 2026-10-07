import { describe, expect, it } from 'vitest';

import { matchHtmlWithTokenizer } from './test-helpers/match-html-with-tokenizer.js';
import { matchHtml } from './test-helpers/match-html.js';

type Case = [selector: string, html: string, expected: boolean];

/** Cases decided by one start tag (the regular expression stage). */
const COMPOUND_CASES: Case[] = [
	['img', '<p><img></p>', true],
	['img', '<p></p>', false],
	['art', '<article></article>', false],
	['div', '<DIV></DIV>', true],
	['*', '<p></p>', true],
	['*', '', false],
	['.foo', '<div class="foo bar"></div>', true],
	['.foo', '<div class="bar foo"></div>', true],
	['.foo', '<div class="foobar"></div>', false],
	['.foo.bar', '<div class="bar foo"></div>', true],
	['.foo.bar', '<div class="foo"></div>', false],
	['#x', '<div id="x"></div>', true],
	['#x', '<div id="xy"></div>', false],
	['a.x[href]', '<a href="/" class="x"></a>', true],
	['a[href^="/p"]', '<a href="/p/1"></a>', true],
	['a[href^="/p"]', '<a href="/q/p"></a>', false],
	['a[href$=".pdf"]', '<a href="/a.pdf"></a>', true],
	['a[href$=".pdf"]', '<a href="/a.pdf?x=1"></a>', false],
	['a[href*="docs"]', '<a href="/my/docs/x"></a>', true],
	['[lang|=en]', '<html lang="en-US"></html>', true],
	['[lang|=en]', '<html lang="english"></html>', false],
	['[rel~=nofollow]', '<a rel="noopener nofollow"></a>', true],
	['[rel~=nofollow]', '<a rel="nofollow-x"></a>', false],
	['[data-x]', '<p data-x=""></p>', true],
	['[data-x]', '<p data-y=""></p>', false],
	['[data-x=""]', '<p data-x=""></p>', true],
	['[data-x^=""]', '<p data-x="a"></p>', false],
	['[data-x*=""]', '<p data-x="a"></p>', false],
	['[data-x~=""]', '<p data-x="a"></p>', false],
	['[class="a"]', '<p class="a"></p>', true],
	['[x="A" i]', '<p x="a"></p>', true],
	['[x="A"]', '<p x="a"></p>', false],
	['[x="A" s]', '<p x="a"></p>', false],
	// class and id tokens are case-sensitive
	['.foo', '<p class="FOO"></p>', false],
	['#x', '<p id="X"></p>', false],
	['[TYPE=text]', '<input type="TEXT">', true],
	// HTML defines the values of some attributes as case-insensitive
	['input[type=text]', '<input type="TEXT">', true],
	['input[type="text" s]', '<input type="TEXT">', false],
	['form[method=post]', '<form method="POST"></form>', true],
	['a[target=_blank]', '<a target="_BLANK"></a>', true],
	['p[dir=rtl]', '<p dir="RTL"></p>', true],
	['a[hreflang=en]', '<a hreflang="EN"></a>', true],
	['link[media=print]', '<link media="PRINT">', true],
	['meta[charset=utf-8]', '<meta charset="UTF-8">', true],
	['meta[http-equiv=refresh]', '<meta http-equiv="REFRESH">', true],
	['a[rel~=nofollow]', '<a rel="NoFollow noopener"></a>', true],
	['[data-type=text]', '<p data-type="TEXT"></p>', false],
	// a `<` inside a quoted value is not the start of a tag
	['img[alt]', '<a title="<img alt>"></a>', false],
	['img', '<a title="<img>"></a>', false],
	['img', '<a title="<template>"></a><img>', true],
	['img', '<a title="<!--"></a><img>', true],
	['[viewbox]', '<svg viewBox="0 0 1 1"></svg>', true],
	['foreignobject', '<svg><foreignObject></foreignObject></svg>', true],
	// entities: the selector's value is compared in its serialized form
	['[href="/?a=1&b=2"]', '<a href="/?a=1&amp;b=2"></a>', true],
	['[href="/?a=1&amp;b=2"]', '<a href="/?a=1&amp;b=2"></a>', false],
	['[href*="&amp;"]', '<a href="/?a=1&amp;amp;b=2"></a>', true],
	['[title*=amp]', '<p title="&amp;"></p>', false],
	['[title*="&"]', '<p title="&amp;"></p>', true],
	['[title$=";"]', '<p title="&amp;"></p>', false],
	['[title$="&"]', '<p title="&amp;"></p>', true],
	['[title^="&"]', '<p title="&amp;x"></p>', true],
	['[title*="a&b"]', '<p title="xa&amp;by"></p>', true],
	['[title~="&"]', '<p title="x &amp; y"></p>', true],
	['[title~="a\u00A0b"]', '<p title="x a&nbsp;b y"></p>', true],
	['[title~="a"]', '<p title="a&nbsp;b"></p>', false],
	['[title="a\u00A0b"]', '<p title="a&nbsp;b"></p>', true],
	['[title="say &quot;hi&quot;"]', '<p title="say &amp;quot;hi&amp;quot;"></p>', true],
	['[title=\'say "hi"\']', '<p title="say &quot;hi&quot;"></p>', true],
	['[href="/A&B" i]', '<a href="/a&amp;b"></a>', true],
	// a `>` or `<` in a value has no single stored form, so the stack stage decides
	['a[title="x>y"]', '<a title="x&gt;y"></a>', true],
	['a[title="x>y"]', '<a title="x>y"></a>', true],
	// :not
	['a:not(.x)', '<a class="x"></a>', false],
	['a:not(.x)', '<a class="x"></a><a></a>', true],
	[':not(span)', '<span></span>', false],
	[':not(span)', '<span></span><b></b>', true],
	['a:not([href]):not(.x)', '<a class="y"></a>', true],
	['a:not([href]):not(.x)', '<a class="x"></a>', false],
	['*:not(*)', '<p></p>', false],
	// selector lists
	['img, video', '<video></video>', true],
	['img, video', '<audio></audio>', false],
	// markup that is not an element
	['img', '<!-- <img> --><p></p>', false],
	['img', '<!-- <p></p> --><img>', true],
	['img', '<!DOCTYPE html><p></p>', false],
	['img', '<![CDATA[ <img> ]]><p></p>', false],
	['img', '<!-- never closed <img>', false],
	['img', '<script>var s = "<img>";</script>', false],
	['img', '<style>a::after{content:"<img>"}</style>', false],
	['img', '<noscript><img></noscript>', false],
	['noscript', '<noscript><img></noscript>', true],
	['img', '<script>"</scripts><img>"</script>', false],
	['img', '<script>x</script><img>', true],
	['img', '<SCRIPT>"<img>"</SCRIPT>', false],
	['img', '<plaintext><img>', false],
	['img', '<textarea>&lt;img&gt;</textarea>', false],
	// raw text elements are still elements
	['script[src]', '<script src="/a.js"></script>', true],
	['script[src]', '<script></script>', false],
	['style', '<style>a{}</style>', true],
	['iframe[src]', '<iframe src="/x"></iframe>', true],
	// <template> content is a separate fragment
	['img', '<template><img></template>', false],
	['img', '<img><template><img></template>', true],
	['img', '<template><img></template><img>', true],
	['img', '<template><template></template><img></template>', false],
	['img', '<template><template></template></template><img>', true],
	['template', '<template><img></template>', true],
];

/** Cases that need the open-element stack. */
const STRUCTURAL_CASES: Case[] = [
	['div p', '<div><section><p></p></section></div>', true],
	['div > p', '<div><section><p></p></section></div>', false],
	['div > section > p', '<div><section><p></p></section></div>', true],
	['a b c', '<a><x><b><y><z><c></c></z></y></b></x></a>', true],
	['a > b c', '<a><b><x><c></c></x></b></a>', true],
	['a > b c', '<a><x><b><c></c></b></x></a>', false],
	['div p', '<div></div><p></p>', false],
	['div > p', '<div><div></div><p></p></div>', true],
	['div div', '<div></div><div></div>', false],
	['div div', '<div><div></div></div>', true],
	['ul > li > a', '<ul><li><a></a></li></ul>', true],
	['ul li', '<ul><li></li></ul>', true],
	['div > p', '<div><img><p></p></div>', true],
	['div > p', '<div><br><p></p></div>', true],
	['p > div', '<p><div></div></p>', true],
	['html > body', '<html><head></head><body></body></html>', true],
	['html > body > p', '<html><body><p></p></body></html>', true],
	['nav .menu a', '<nav><ul><li class="menu"><a></a></li></ul></nav>', true],
	['nav .menu a', '<nav><ul><li class="menu"></li></ul><a></a></nav>', false],
	['div > p', '<div><script>"<p>"</script></div>', false],
	['div > noscript', '<div><noscript><p></p></noscript></div>', true],
	['noscript p', '<noscript><p></p></noscript>', false],
	['div > template', '<div><template><img></template></div>', true],
	['div img', '<div><template><img></template></div>', false],
	['template img', '<template><img></template>', false],
	['body img', '<body><template><template></template><img></template></body>', false],
	['body img', '<body><template></template><img></body>', true],
	['x > p', '<x><template></template><p></p></x>', true],
	// stray and unclosed tags are read as written
	['div > p', '<div><p>', true],
	['div p', '</div><p></p>', false],
	['div > p', '<div></span><p></p></div>', true],
	// `/>` closes an element at once
	['x > p', '<x/><p></p>', false],
	['div p', '<div><br/><p></p></div>', true],
	// stray end tag inside a template
	['img', '<template></p><img></template>', false],
	// sibling position
	['li:first-child', '<ul><li></li></ul>', true],
	['li:first-child', '<ul><b></b><li></li></ul>', false],
	['li:nth-child(2)', '<ul><li></li><li></li></ul>', true],
	['li:nth-child(2)', '<ul><li></li></ul>', false],
	['li:nth-child(2n)', '<ul><li></li><li></li></ul>', true],
	['li:nth-child(2n)', '<ul><li></li></ul>', false],
	['li:nth-child(2n+1)', '<ul><li></li></ul>', true],
	['li:nth-child(odd)', '<ul><li></li></ul>', true],
	['li:nth-child(even)', '<ul><li></li></ul>', false],
	['li:nth-child(-n+2)', '<ul><b></b><b></b><li></li></ul>', false],
	['li:nth-child(-n+2)', '<ul><b></b><li></li></ul>', true],
	['li:nth-child(n+3)', '<ul><li></li><li></li></ul>', false],
	['li:nth-child(n+3)', '<ul><li></li><li></li><li></li></ul>', true],
	['li:nth-child(2)', '<ul><li></li></ul><ul><li></li></ul>', false],
	['li:first-child', '<ul>text<li></li></ul>', true],
	['li:nth-child(2)', '<ul><li><li></li></li></ul>', false],
	['p:nth-of-type(2)', '<div><p></p><span></span><p></p></div>', true],
	['p:nth-child(2)', '<div><p></p><span></span><p></p></div>', false],
	['span:nth-child(2)', '<div><p></p><span></span><p></p></div>', true],
	['p:first-of-type', '<div><span></span><p></p></div>', true],
	['p:first-of-type', '<div><p></p><p></p></div>', true],
	['div > p:first-of-type', '<div><p></p></div>', true],
	['li:not(:first-child)', '<ul><li></li></ul>', false],
	['li:not(:first-child)', '<ul><li></li><li></li></ul>', true],
	['ul > li:not(.a):nth-child(2)', '<ul><li></li><li class="a"></li></ul>', false],
	// the template element is a sibling; its content is not
	['p:nth-child(2)', '<template><b></b></template><p></p>', true],
	['p:nth-child(3)', '<template><b></b></template><p></p>', false],
	['p:nth-child(3)', '<b></b><template><b></b></template><p></p>', true],
	// lists mixing both stages
	['img, ul > li', '<ul><li></li></ul>', true],
	['img, ul > li', '<ul></ul>', false],
	['img, ul > li', '<template><img></template>', false],
	['img, ul > li', '<template><img></template><img>', true],
];

describe('htmlMatchesSelector', () => {
	describe('single-compound selectors', () => {
		it.each(COMPOUND_CASES)('%s on %s → %s', (selector, html, expected) => {
			expect(matchHtml(selector, html).matched).toBe(expected);
		});
	});

	describe('selectors that need the open-element stack', () => {
		it.each(STRUCTURAL_CASES)('%s on %s → %s', (selector, html, expected) => {
			expect(matchHtml(selector, html).matched).toBe(expected);
		});
	});

	describe('the stack stage agrees with the regular expression stage', () => {
		it.each(COMPOUND_CASES)('%s on %s → %s', (selector, html, expected) => {
			expect(matchHtmlWithTokenizer(selector, html).matched).toBe(expected);
		});
	});

	describe('stage accounting', () => {
		it('decides a single compound without the stack', () => {
			expect(matchHtml('img', '<p><img></p>')).toMatchObject({
				matched: true,
				tokenized: false,
				prefiltered: false,
			});
			// the literal `<img` is there but only inside a comment: the scan reads it
			expect(matchHtml('img', '<!-- <img> --><p></p>')).toMatchObject({
				matched: false,
				tokenized: false,
				prefiltered: false,
			});
		});

		it('rejects a single compound without scanning when its literal is missing', () => {
			expect(matchHtml('img', '<p></p>')).toMatchObject({
				matched: false,
				tokenized: false,
				prefiltered: true,
			});
			expect(matchHtml('[data-x="vv"]', '<p data-y="w"></p>')).toMatchObject({
				matched: false,
				prefiltered: true,
			});
		});

		it('counts a mixed list as prefiltered only when no stage scanned the markup', () => {
			expect(matchHtml('img, nav a', '<p></p>')).toMatchObject({
				matched: false,
				prefiltered: true,
				tokenized: false,
			});
			// the scan for `img` read the comment, so the document was not rejected on literals
			expect(matchHtml('img, nav a', '<!-- <img> --><p></p>')).toMatchObject({
				matched: false,
				prefiltered: false,
				tokenized: false,
			});
			expect(matchHtml('img, nav a', '<nav><a></a></nav>')).toMatchObject({
				matched: true,
				tokenized: true,
			});
		});

		it('cannot reject on literals when none can be derived', () => {
			expect(matchHtml('*', '')).toMatchObject({ matched: false, prefiltered: false });
			expect(matchHtml(':not(.x)', '<p class="x"></p>')).toMatchObject({
				matched: false,
				prefiltered: false,
			});
		});

		it('skips the scan only for the alternatives whose literals are missing', () => {
			expect(matchHtml('img, video', '<video></video>')).toMatchObject({
				matched: true,
				tokenized: false,
				prefiltered: false,
			});
			expect(matchHtml('img, video', '<img>').matched).toBe(true);
			expect(matchHtml('img, nav a', '<nav><a></a></nav>')).toMatchObject({
				matched: true,
			});
		});

		it('rejects with the prefilter when a required literal is missing', () => {
			expect(matchHtml('nav .menu a', '<div><a></a></div>')).toMatchObject({
				matched: false,
				prefiltered: true,
				tokenized: false,
			});
		});

		it('rejects with the prefilter when the literals are in the wrong order', () => {
			expect(matchHtml('nav a', '<a></a><nav></nav>')).toMatchObject({
				matched: false,
				prefiltered: true,
			});
		});

		it('hands the whole document to the stack at a template', () => {
			expect(matchHtml('img', '<template><img></template>')).toMatchObject({
				matched: false,
				tokenized: true,
			});
		});

		it('runs the stack for sibling-position selectors', () => {
			expect(matchHtml('li:nth-child(2)', '<ul><li></li><li></li></ul>')).toMatchObject({
				matched: true,
				tokenized: true,
			});
		});
	});

	describe('early exit', () => {
		it('stops at the first element that completes a chain', () => {
			const tail = '<p></p>'.repeat(5000);
			const outcome = matchHtml('a > b', `<a><b></b></a>${tail}`);
			expect(outcome.matched).toBe(true);
			expect(outcome.elementsVisited).toBeLessThan(10);
		});

		it('visits every element when nothing matches', () => {
			const outcome = matchHtml('a > b', `<a></a><i></i>${'<p></p>'.repeat(100)}<b></b>`);
			expect(outcome.matched).toBe(false);
			expect(outcome.elementsVisited).toBe(103);
		});
	});

	describe('selectors that cannot be answered from the markup alone', () => {
		it('reads comment text that closes another comment as markup, per the interpretation rules', () => {
			// `<!---->` `<img>` `<!---->` serializes from two DOMs: an img between two
			// empty comments, or one comment whose text is `--><img><!--`.
			expect(matchHtml('img', '<!----><img><!---->').matched).toBe(true);
		});

		it('reads a script whose text holds its own end tag as markup', () => {
			expect(matchHtml('img', '<script></script><img><script></script>').matched).toBe(
				true,
			);
		});
	});

	it('is not misled by a quoted > inside an attribute value', () => {
		expect(matchHtml('a > b', '<a title="x > y"><b></b></a>').matched).toBe(true);
	});

	it('handles an empty document', () => {
		expect(matchHtml('a > b', '').matched).toBe(false);
	});
});
