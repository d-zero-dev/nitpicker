import { describe, it, expect } from 'vitest';

import { isHtmlContentType } from './is-html-content-type.js';

describe('isHtmlContentType', () => {
	it.each(['text/html', 'text/HTML', 'TEXT/HTML', 'Text/Html'])(
		'returns true for %s regardless of letter case',
		(contentType) => {
			expect(isHtmlContentType(contentType)).toBe(true);
		},
	);

	it.each(['text/html ', ' text/html', '\ttext/html\t'])(
		'returns true for %j with surrounding whitespace',
		(contentType) => {
			expect(isHtmlContentType(contentType)).toBe(true);
		},
	);

	it.each(['image/png', 'application/json', 'text/plain', 'text/htm', ''])(
		'returns false for non-HTML media type %s',
		(contentType) => {
			expect(isHtmlContentType(contentType)).toBe(false);
		},
	);

	it('returns false for null', () => {
		expect(isHtmlContentType(null)).toBe(false);
	});
});
