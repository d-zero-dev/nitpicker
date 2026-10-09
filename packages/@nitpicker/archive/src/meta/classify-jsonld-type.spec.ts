import { describe, it, expect } from 'vitest';

import { classifyJsonLdType } from './classify-jsonld-type.js';

describe('classifyJsonLdType', () => {
	it('returns the string @type for single-type entries', () => {
		expect(classifyJsonLdType({ raw: '', parsed: { '@type': 'Product' } })).toBe(
			'Product',
		);
	});

	it('returns the first string element when @type is an array', () => {
		expect(
			classifyJsonLdType({ raw: '', parsed: { '@type': ['Product', 'Offer'] } }),
		).toBe('Product');
	});

	it('skips non-string array elements and returns the first valid one', () => {
		expect(
			classifyJsonLdType({ raw: '', parsed: { '@type': [null, '', 'Article'] } }),
		).toBe('Article');
	});

	it('returns null when parsed is missing (parse error path)', () => {
		expect(classifyJsonLdType({ raw: '{', parseError: 'Unexpected end' })).toBeNull();
	});

	it('returns null when @type is missing', () => {
		expect(classifyJsonLdType({ raw: '', parsed: { '@graph': [] } })).toBeNull();
	});

	it('returns null when parsed is a string scalar (malformed JSON-LD)', () => {
		expect(classifyJsonLdType({ raw: '"x"', parsed: 'x' })).toBeNull();
	});

	it('trims whitespace from @type values', () => {
		expect(classifyJsonLdType({ raw: '', parsed: { '@type': '  Article  ' } })).toBe(
			'Article',
		);
	});

	it('returns null when @type is an empty string', () => {
		expect(classifyJsonLdType({ raw: '', parsed: { '@type': '' } })).toBeNull();
	});

	it('returns null when @type is an array of empty strings', () => {
		expect(classifyJsonLdType({ raw: '', parsed: { '@type': ['', '   '] } })).toBeNull();
	});
});
