import { describe, expect, it } from 'vitest';

import { parseStartTagAttributes } from './parse-start-tag-attributes.js';

describe('parseStartTagAttributes', () => {
	it('reads quoted values and value-less attributes', () => {
		const attributes = parseStartTagAttributes(' class="a b" disabled="" hidden');
		expect(Object.fromEntries(attributes)).toEqual({
			class: 'a b',
			disabled: '',
			hidden: '',
		});
	});

	it('lower-cases names and keeps the first of a repeated name', () => {
		const attributes = parseStartTagAttributes(' DATA-X="1" data-x="2"');
		expect(Object.fromEntries(attributes)).toEqual({ 'data-x': '1' });
	});

	it('decodes the serializer entities in values', () => {
		expect(parseStartTagAttributes(' href="/?a=1&amp;b=2"').get('href')).toBe(
			'/?a=1&b=2',
		);
	});

	it('keeps a > inside a quoted value', () => {
		expect(parseStartTagAttributes(' title="a > b" id="x"').get('id')).toBe('x');
		expect(parseStartTagAttributes(' title="a > b"').get('title')).toBe('a > b');
	});

	it('accepts single-quoted and unquoted values', () => {
		const attributes = parseStartTagAttributes(" a='1' b=2 c = 3");
		expect(Object.fromEntries(attributes)).toEqual({ a: '1', b: '2', c: '3' });
	});

	it('ignores a trailing slash and empty input', () => {
		expect([...parseStartTagAttributes(' a="1" /')]).toEqual([['a', '1']]);
		expect(parseStartTagAttributes('').size).toBe(0);
	});
});
