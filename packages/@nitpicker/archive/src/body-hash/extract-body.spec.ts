import { describe, it, expect } from 'vitest';

import { extractBody } from './extract-body.js';

describe('extractBody', () => {
	it('extracts the content between <body> and </body>', () => {
		const html =
			'<html><head><title>t</title></head><body class="x">CONTENT</body></html>';
		expect(extractBody(html)).toBe('CONTENT');
	});

	it('matches <body> case-insensitively', () => {
		const html = '<HTML><BODY>CONTENT</BODY></HTML>';
		expect(extractBody(html)).toBe('CONTENT');
	});

	it('extracts content when <body> has multiple attributes', () => {
		const html = '<body id="a" data-x="y" class="z w">CONTENT</body>';
		expect(extractBody(html)).toBe('CONTENT');
	});

	it('falls back to the full input when there is no <body> tag', () => {
		const html = '<div>fragment only</div>';
		expect(extractBody(html)).toBe(html);
	});

	it('falls back to the full input for an empty string', () => {
		expect(extractBody('')).toBe('');
	});

	it('falls back to the full input when </body> is missing (cut-off render)', () => {
		const html = '<html><body>partial content that never closes';
		expect(extractBody(html)).toBe(html);
	});

	it('extracts content correctly when an attribute value contains a literal >', () => {
		// Regression guard: a naive `[^>]*` opening-tag scan would stop at
		// the `>` inside `data-x="a>b"`, mid-attribute, before the real
		// closing `>` of the tag.
		const html = '<body data-x="a>b" class="foo">CONTENT</body>';
		expect(extractBody(html)).toBe('CONTENT');
	});

	it('extracts content correctly when an attribute value contains a literal < (single-quoted)', () => {
		const html = '<body data-x=\'a<b\' class="foo">CONTENT</body>';
		expect(extractBody(html)).toBe('CONTENT');
	});

	it('extends the match to the last </body> when the body contains a literal <body> substring', () => {
		const html =
			'<body>before <code>&lt;body&gt;example&lt;/body&gt;</code> after</body>';
		expect(extractBody(html)).toBe(
			'before <code>&lt;body&gt;example&lt;/body&gt;</code> after',
		);
	});
});
