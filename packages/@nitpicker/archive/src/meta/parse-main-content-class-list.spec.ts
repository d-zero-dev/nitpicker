import { describe, expect, it } from 'vitest';

import { parseMainContentClassList } from './parse-main-content-class-list.js';

describe('parseMainContentClassList', () => {
	it('JSON 配列の文字列をクラス名の配列にする', () => {
		expect(parseMainContentClassList('["spc","wide"]')).toEqual(['spc', 'wide']);
	});

	it('空配列はそのまま空配列にする', () => {
		expect(parseMainContentClassList('[]')).toEqual([]);
	});

	it('null（本文要素が未検出）は null のまま返す', () => {
		expect(parseMainContentClassList(null)).toBeNull();
	});

	it('JSON として壊れた値は値を含む説明つきのエラーにする', () => {
		expect(() => parseMainContentClassList('{oops')).toThrow(
			'main_content_class_list is not valid JSON: {oops',
		);
	});

	it('文字列配列でない JSON は説明つきのエラーにする', () => {
		expect(() => parseMainContentClassList('{"a":1}')).toThrow(
			'main_content_class_list is not a JSON array of strings: {"a":1}',
		);
		expect(() => parseMainContentClassList('[1]')).toThrow(
			'main_content_class_list is not a JSON array of strings: [1]',
		);
	});
});
