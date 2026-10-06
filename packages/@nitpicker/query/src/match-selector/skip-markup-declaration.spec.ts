import { describe, expect, it } from 'vitest';

import { skipMarkupDeclaration } from './skip-markup-declaration.js';

describe('skipMarkupDeclaration', () => {
	it.each([
		['<!-- <img> --><b>', '<!--', 14],
		['<![CDATA[ <img> ]]><b>', '<![CDATA[', 19],
		['<!DOCTYPE html><b>', '<!', 15],
	])('%s', (html, opener, expected) => {
		expect(
			skipMarkupDeclaration({ html: html, opener: opener, from: opener.length }),
		).toBe(expected);
		expect(html.slice(expected)).toBe('<b>');
	});

	it('ends a comment at the first --> after the opener', () => {
		const html = '<!--> <img> --><b>';
		expect(
			html.slice(skipMarkupDeclaration({ html: html, opener: '<!--', from: 4 })),
		).toBe('<b>');
	});

	it('runs an unterminated one to the end of the document', () => {
		expect(skipMarkupDeclaration({ html: '<!-- <img>', opener: '<!--', from: 4 })).toBe(
			'<!-- <img>'.length,
		);
	});
});
