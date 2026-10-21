import { describe, it, expect } from 'vitest';

import { quoteIdentifier } from './quote-identifier.mjs';

describe('quoteIdentifier', () => {
	it('wraps a plain name in double quotes', () => {
		expect(quoteIdentifier('viewer_pages')).toBe('"viewer_pages"');
	});

	it('doubles an embedded double quote, so the name cannot end the identifier early', () => {
		expect(quoteIdentifier('a"b')).toBe('"a""b"');
		expect(quoteIdentifier('x"; DROP TABLE t; --')).toBe('"x""; DROP TABLE t; --"');
	});

	it('keeps other characters, including single quotes and spaces, as they are', () => {
		expect(quoteIdentifier("it's a name")).toBe(`"it's a name"`);
	});
});
