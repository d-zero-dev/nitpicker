import type { TagEvent } from './types.js';

import { describe, expect, it } from 'vitest';

import { createHtmlTagTokenizer } from './create-html-tag-tokenizer.js';

/**
 * Reads every tag event out of a document.
 * @param html - The markup.
 */
function tokenize(html: string): TagEvent[] {
	const tokenizer = createHtmlTagTokenizer(html);
	const events: TagEvent[] = [];
	for (let event = tokenizer.next(); event !== null; event = tokenizer.next()) {
		events.push(event);
	}
	return events;
}

const open = (name: string, attrSource = '', leaf = false): TagEvent => ({
	kind: 'open',
	name,
	attrSource,
	leaf,
});
const close = (name: string): TagEvent => ({ kind: 'close', name });

describe('createHtmlTagTokenizer', () => {
	it('returns start and end tags in order, skipping text', () => {
		expect(tokenize('<p class="a">text <b>x</b></p>')).toEqual([
			open('p', ' class="a"'),
			open('b'),
			close('b'),
			close('p'),
		]);
	});

	it('lower-cases names', () => {
		expect(tokenize('<DIV></Div>')).toEqual([open('div'), close('div')]);
	});

	it('marks void elements and self-closed tags childless', () => {
		expect(tokenize('<br><img src="a"><x/><y a="1" />')).toEqual([
			open('br', '', true),
			open('img', ' src="a"', true),
			open('x', '/', true),
			open('y', ' a="1" /', true),
		]);
	});

	it('skips comments, CDATA sections and declarations', () => {
		expect(tokenize('<!DOCTYPE html><!-- <i> --><![CDATA[ <u> ]]><b>')).toEqual([
			open('b'),
		]);
	});

	it('skips an unterminated comment to the end', () => {
		expect(tokenize('<a><!-- <b>')).toEqual([open('a')]);
	});

	it('keeps a > inside a quoted attribute value', () => {
		expect(tokenize('<a title="x > y"><b>')).toEqual([
			open('a', ' title="x > y"'),
			open('b'),
		]);
	});

	it.each(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'])(
		'returns %s as a childless element and swallows its content and end tag',
		(name) => {
			expect(tokenize(`<${name} a="1"><i></i></${name}><b>`)).toEqual([
				open(name, ' a="1"', true),
				open('b'),
			]);
		},
	);

	it('lets a raw text element run to the end without an end tag', () => {
		expect(tokenize('<script>"<i>"')).toEqual([open('script', '', true)]);
		expect(tokenize('<plaintext><i></plaintext><b>')).toEqual([
			open('plaintext', '', true),
		]);
	});

	it('does not end a raw text element at a different end tag', () => {
		expect(tokenize('<script>"</i>"</script><b>')).toEqual([
			open('script', '', true),
			open('b'),
		]);
	});

	it('returns a template and the elements inside it as ordinary tags', () => {
		expect(tokenize('<template><i></i></template>')).toEqual([
			open('template'),
			open('i'),
			close('i'),
			close('template'),
		]);
	});

	it('ignores text that only looks like a tag', () => {
		expect(tokenize('a < b and 1<2 &lt;i&gt; </ > <1>')).toEqual([]);
	});

	it('returns null at the end and for an empty document', () => {
		const tokenizer = createHtmlTagTokenizer('<a>');
		expect(tokenizer.next()).toEqual(open('a'));
		expect(tokenizer.next()).toBeNull();
		expect(tokenizer.next()).toBeNull();
		expect(tokenize('')).toEqual([]);
	});

	it('keeps independent readers independent', () => {
		const first = createHtmlTagTokenizer('<a><b>');
		const second = createHtmlTagTokenizer('<x>');
		expect(first.next()).toEqual(open('a'));
		expect(second.next()).toEqual(open('x'));
		expect(first.next()).toEqual(open('b'));
	});
});
