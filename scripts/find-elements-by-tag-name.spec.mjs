import { parse } from 'parse5';
import { describe, it, expect } from 'vitest';

import { findElementsByTagName } from './find-elements-by-tag-name.mjs';

describe('findElementsByTagName', () => {
	it('returns an empty array when the tag is absent', () => {
		const document = parse(
			'<!doctype html><html><body><p>no images here</p></body></html>',
		);
		expect(findElementsByTagName(document, 'img')).toEqual([]);
	});

	it('finds a single matching element', () => {
		const document = parse('<!doctype html><html><body><img id="only"></body></html>');
		const [element] = findElementsByTagName(document, 'img');
		expect(element.attrs).toEqual([{ name: 'id', value: 'only' }]);
	});

	it('returns matches in document order across nested branches', () => {
		const document = parse(
			'<!doctype html><html><body><main><img id="a"></main><footer><img id="b"></footer></body></html>',
		);
		const matches = findElementsByTagName(document, 'img');
		expect(matches.map((el) => el.attrs)).toEqual([
			[{ name: 'id', value: 'a' }],
			[{ name: 'id', value: 'b' }],
		]);
	});

	it('does not match text or comment nodes', () => {
		const document = parse(
			'<!doctype html><html><body><!--img-->img as text</body></html>',
		);
		expect(findElementsByTagName(document, 'img')).toEqual([]);
	});
});
