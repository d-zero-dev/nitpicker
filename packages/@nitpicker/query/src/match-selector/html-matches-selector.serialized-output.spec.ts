import { describe, expect, it } from 'vitest';

import { matchHtmlWithTokenizer } from './test-helpers/match-html-with-tokenizer.js';
import { matchHtml } from './test-helpers/match-html.js';

/**
 * What a browser serializes for a page whose source forgot the closing
 * quote of `content="…`: the value swallows the rest of the line up to the
 * next quote, and what follows (` og:locale"`) is an attribute whose *name*
 * contains a quote.
 */
const UNCLOSED_CONTENT_QUOTE =
	'<head><meta name="description" content="Example.&gt;\n\n  &lt;meta property=" og:locale"="">' +
	'<meta property="og:title" content="T"><title>t</title></head>';

describe('matching the serialized form of malformed source', () => {
	it.each([
		['meta[name="description"]', true],
		['meta[content^="Example"]', true],
		['meta[property="og:title"]', true],
		['head > meta[name="description"]', true],
		['head > meta:nth-child(2)', true],
		['meta[property="property"]', false],
		['meta[property=" og:locale"]', false],
		['title', true],
	])('%s → %s', (selector, expected) => {
		expect(matchHtml(selector, UNCLOSED_CONTENT_QUOTE).matched).toBe(expected);
		expect(matchHtmlWithTokenizer(selector, UNCLOSED_CONTENT_QUOTE).matched).toBe(
			expected,
		);
	});

	it('does not lose the elements after a tag with a quote in an attribute name', () => {
		const html = '<div><p a"b="1" c="2">x</p><img alt=""></div>';
		expect(matchHtml('img[alt]', html).matched).toBe(true);
		expect(matchHtml('p[c="2"]', html).matched).toBe(true);
		expect(matchHtml('div > img', html).matched).toBe(true);
	});

	it('does not read a tag that is never closed as an element', () => {
		expect(matchHtml('img', '<p title="x><img>').matched).toBe(true);
		expect(matchHtml('p[title]', '<p title="x><img>').matched).toBe(false);
	});
});
