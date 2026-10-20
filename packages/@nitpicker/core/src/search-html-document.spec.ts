import type { NativeSearchPattern } from './types.js';

import { describe, it, expect } from 'vitest';

import { searchHtmlDocument } from './search-html-document.js';

/**
 * A regular-expression pattern.
 * @param source - The regular expression's source.
 * @param flags - Which of `i`, `m`, `s` apply.
 */
function regex(source: string, flags = ''): NativeSearchPattern {
	return {
		source,
		literal: false,
		ignoreCase: flags.includes('i'),
		multiLine: flags.includes('m'),
		dotAll: flags.includes('s'),
	};
}

/**
 * A literal pattern.
 * @param source - The text to find.
 */
function literal(source: string): NativeSearchPattern {
	return { source, literal: true, ignoreCase: false, multiLine: false, dotAll: false };
}

describe('searchHtmlDocument: the pattern contract', () => {
	it.each<{ name: string; pattern: NativeSearchPattern; html: string; count: number }>([
		{
			name: 'a literal is not a regex',
			pattern: literal('He.lo'),
			html: 'Hello',
			count: 0,
		},
		{
			name: 'a literal matches itself',
			pattern: literal('He.lo'),
			html: 'He.lo',
			count: 1,
		},
		{ name: 'i ignores case', pattern: regex('abc', 'i'), html: 'ABC abc', count: 2 },
		{ name: 'without i case matters', pattern: regex('abc'), html: 'ABC', count: 0 },
		{ name: 's lets . cross \\n', pattern: regex('a.b', 's'), html: 'a\nb', count: 1 },
		{ name: 'without s . stops at \\n', pattern: regex('a.b'), html: 'a\nb', count: 0 },
		{
			name: '. does not stop at U+2028 (JavaScript would)',
			pattern: regex('a.b'),
			html: 'a b',
			count: 1,
		},
		{
			name: '. stops at a carriage return',
			pattern: regex('a.b'),
			html: 'a\rb',
			count: 0,
		},
		{
			name: 'm: $ sees a CRLF line end',
			pattern: regex('foo$', 'm'),
			html: 'foo\r\nbar',
			count: 1,
		},
		{
			name: 'm: ^ sees a lone CR as a line start',
			pattern: regex('^bar', 'm'),
			html: 'foo\rbar',
			count: 1,
		},
		{
			name: 'm anchors at every line',
			pattern: regex('^b$', 'm'),
			html: 'a\nb\nc',
			count: 1,
		},
		{
			name: 'without m ^ anchors the document',
			pattern: regex('^b$'),
			html: 'a\nb\nc',
			count: 0,
		},
		{ name: '. matches an emoji once', pattern: regex('^.$'), html: '😀', count: 1 },
		{
			name: '\\d includes Unicode digits',
			pattern: regex(String.raw`\d+`),
			html: 'x٣٤y',
			count: 1,
		},
		{
			name: '\\w includes Unicode letters',
			pattern: regex(String.raw`^\w+$`),
			html: 'été',
			count: 1,
		},
		{ name: 'matches do not overlap', pattern: regex('aa'), html: 'aaaaa', count: 2 },
		{
			name: '\\< is a word boundary, not a literal <',
			pattern: regex(String.raw`\<a`),
			html: ' a',
			count: 1,
		},
		{
			name: 'i folds the Kelvin sign onto k',
			pattern: regex('k', 'i'),
			html: '\u212A',
			count: 1,
		},
		{ name: 'i folds Unicode case', pattern: regex('é', 'i'), html: 'É é', count: 2 },
		{ name: 'i folds the sharp s', pattern: regex('ß', 'i'), html: 'ẞ ß', count: 2 },
		{
			name: 'an inline flag works inside the pattern',
			pattern: regex('(?i)abc'),
			html: 'ABC',
			count: 1,
		},
		{
			name: 'an empty match between non-word characters counts (\\B)',
			pattern: regex(String.raw`\B`),
			html: '--',
			count: 3,
		},
		{
			name: 'm lets ^ match an empty line start',
			pattern: regex('^', 'm'),
			html: 'a\nb',
			count: 2,
		},
		{
			name: 'an empty match inside a document counts',
			pattern: regex(String.raw`\b`),
			html: 'ab cd',
			count: 4,
		},
	])('$name', ({ pattern, html, count }) => {
		expect(searchHtmlDocument({ pattern, html, snippetLength: 20 }).matchCount).toBe(
			count,
		);
	});

	it.each([
		{ name: 'a backreference', source: String.raw`(a)\1` },
		{ name: 'a lookahead', source: '(?=a)a' },
		{ name: 'a negative lookahead', source: '(?!a)b' },
		{ name: 'a lookbehind', source: '(?<=a)b' },
		{ name: 'an unclosed group', source: '(' },
		{ name: 'a literal { that JavaScript accepts', source: 'a{' },
		{
			name: 'a class as a range end that JavaScript accepts',
			source: String.raw`[\\w-.]`,
		},
		{ name: 'an empty negated class', source: '[^]' },
	])('rejects $name with InvalidArg', ({ source }) => {
		expect(() =>
			searchHtmlDocument({ pattern: regex(source), html: 'a', snippetLength: 20 }),
		).toThrow(expect.objectContaining({ code: 'InvalidArg' }));
	});

	it('reads invalid UTF-8 as replacement characters', () => {
		const html = Buffer.concat([Buffer.from('a'), Buffer.from([255]), Buffer.from('b')]);
		const outcome = searchHtmlDocument({
			pattern: regex('a�b'),
			html,
			snippetLength: 20,
		});
		expect(outcome.matchCount).toBe(1);
	});
});

describe('searchHtmlDocument: the snippet', () => {
	it('is empty without a match', () => {
		expect(
			searchHtmlDocument({ pattern: literal('x'), html: 'abc', snippetLength: 20 }),
		).toEqual({ matchCount: 0, snippet: '' });
	});

	it('is a window of snippetLength characters centred on the first match', () => {
		const outcome = searchHtmlDocument({
			pattern: literal('abcd'),
			html: '0123456789abcdefghij',
			snippetLength: 6,
		});
		expect(outcome.snippet).toBe('9abcde');
	});

	it('collapses whitespace and trims the ends', () => {
		const outcome = searchHtmlDocument({
			pattern: literal('b'),
			html: ' \n a  \t b c \n ',
			snippetLength: 100,
		});
		expect(outcome.snippet).toBe('a b c');
	});

	it('counts the window in characters, not UTF-16 units or bytes', () => {
		const html = 'あいうえお😀かきくけこ';
		expect(
			searchHtmlDocument({ pattern: literal('え'), html, snippetLength: 4 }).snippet,
		).toBe('いうえお');
		expect(
			searchHtmlDocument({ pattern: literal('😀'), html, snippetLength: 3 }).snippet,
		).toBe('お😀か');
	});

	it('collapses whitespace before it cuts the window, so indentation does not shorten the snippet', () => {
		const html = `<ul>\n${' '.repeat(40)}<li>one</li>\n${' '.repeat(40)}<li>two</li>\n</ul>`;
		const outcome = searchHtmlDocument({
			pattern: literal('one'),
			html,
			snippetLength: 20,
		});
		expect(outcome.snippet).toBe('<ul> <li>one</li> <l');
		expect(outcome.snippet).toHaveLength(20);
	});

	it('is empty for a snippetLength of 0 while still counting', () => {
		expect(
			searchHtmlDocument({ pattern: literal('b'), html: 'abc', snippetLength: 0 }),
		).toEqual({ matchCount: 1, snippet: '' });
	});

	it('accepts the document as a string or as bytes alike', () => {
		const options = { pattern: literal('é'), snippetLength: 5 };
		expect(searchHtmlDocument({ ...options, html: 'aéb' })).toEqual(
			searchHtmlDocument({ ...options, html: Buffer.from('aéb', 'utf8') }),
		);
	});
});
