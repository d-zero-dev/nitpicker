import { describe, expect, it } from 'vitest';

import { computeShapeKey } from './compute-shape-key.js';

describe('computeShapeKey', () => {
	it('数字のみのpathセグメントを同一shapeに畳む', () => {
		const a = computeShapeKey('//example.com/news/date/2024/');
		const b = computeShapeKey('//example.com/news/date/2025/');
		expect(a).toBe(b);
	});

	it('科学表記に化けたトークンも同じ元セグメントの数値トークンと同一shapeになる', () => {
		const a = computeShapeKey('//example.com/news/date/2024/');
		const b = computeShapeKey('//example.com/news/date/1.5e+32/');
		expect(a).toBe(b);
	});

	it('2次元trap（path + サブページ）を1つのshapeに畳む', () => {
		const a = computeShapeKey('//example.com/news/date/2024/page/3/');
		const b = computeShapeKey('//example.com/news/date/2025/page/9/');
		expect(a).toBe(b);
	});

	it('query値のtrapを同一shapeに畳む（数値でもランダム文字列でも）', () => {
		const a = computeShapeKey('//example.com/list?page=1');
		const b = computeShapeKey('//example.com/list?page=2');
		const c = computeShapeKey('//example.com/list?session=ab12cd');
		const d = computeShapeKey('//example.com/list?session=gh34ij');
		expect(a).toBe(b);
		expect(c).toBe(d);
		expect(a).not.toBe(c);
	});

	it('数字を含まない正当な階層違いは別shapeになる', () => {
		const a = computeShapeKey('//example.com/recruit/');
		const b = computeShapeKey('//example.com/business/');
		expect(a).not.toBe(b);
	});

	it('数字を含むセグメントは混在文字列でも丸ごと畳む（item42 と item99 は同一shape）', () => {
		const a = computeShapeKey('//example.com/item42');
		const b = computeShapeKey('//example.com/item99');
		expect(a).toBe(b);
	});

	it('ホストが異なれば別shapeになる', () => {
		const a = computeShapeKey('//example.com/news/date/2024/');
		const b = computeShapeKey('//other.example.com/news/date/2024/');
		expect(a).not.toBe(b);
	});

	it('decomposeできないURLはnullを返す', () => {
		expect(computeShapeKey('not-a-url')).toBeNull();
	});

	describe('クエリキーに埋め込まれた可変値（issue #351）', () => {
		it('二重エンコードされたkey=value&...ブロブが可変値違いでも同一shapeに畳む', () => {
			// 元の意味: `?undefined=&r=1:42====,2:999` を1段パーセントエンコードした状態で
			// href に埋め込まれたケース（issue #351 の実測ケース）。可変部分（42 / 43）は
			// クエリキー名の中に埋まっているため、flatten なしでは別shapeになってしまう。
			const a = computeShapeKey(
				'//example.com/search/index.html?undefined%3D%26r%3D1%3A42%3D%3D%3D%3D%2C2%3A999=',
			);
			const b = computeShapeKey(
				'//example.com/search/index.html?undefined%3D%26r%3D1%3A43%3D%3D%3D%3D%2C2%3A999=',
			);
			expect(a).toBe('example.com/search/index.html?r={v}&undefined={v}');
			expect(a).toBe(b);
		});

		it('多重（2段）エンコードされたブロブも段数分デコードしてから展開する', () => {
			// `a=1&b=2` を2段パーセントエンコード（encodeURIComponent を2回適用）した
			// クエリキー。1段デコードしただけでは `=`/`&` が現れず（%3D/%26 のまま）、
			// デコードで変化がなくなるまで先に剥がしてから split する必要がある。
			const doubleEncoded = encodeURIComponent(encodeURIComponent('a=1&b=2'));
			const a = computeShapeKey(`//example.com/list?${doubleEncoded}&page=1`);
			expect(a).toBe('example.com/list?a={v}&b={v}&page={v}');
		});

		it('展開後のサブキー出現順序が異なっても同一shapeに畳む', () => {
			const a = computeShapeKey(
				'//example.com/search/index.html?undefined%3D%26r%3D1%3A42%3D%3D%3D%3D%2C2%3A999=',
			);
			const b = computeShapeKey(
				'//example.com/search/index.html?r%3D1%3A99%3D%3D%3D%3D%2C3%3A888%26undefined%3D=',
			);
			expect(a).not.toBeNull();
			expect(a).toBe(b);
		});

		it('不正なパーセントエンコード（デコード不能）でも例外を投げず、元のキーを使う', () => {
			expect(() => computeShapeKey('//example.com/list?100%=abc')).not.toThrow();
			const a = computeShapeKey('//example.com/list?100%=abc');
			const b = computeShapeKey('//example.com/list?100%=xyz');
			expect(a).not.toBeNull();
			expect(a).toBe(b);
		});

		it('通常のクエリキー（可変値の埋め込みがない）は従来どおりの挙動を維持する', () => {
			const a = computeShapeKey('//example.com/list?page=1&sort=name');
			expect(a).toBe('example.com/list?page={v}&sort={v}');
		});

		it('同名クエリキーの重複（正当な複数選択フィルタ）は単一出現と別shapeのまま維持する', () => {
			const duplicated = computeShapeKey('//example.com/list?tag=a&tag=b');
			const single = computeShapeKey('//example.com/list?tag=a');
			expect(duplicated).not.toBeNull();
			expect(duplicated).not.toBe(single);
		});
	});
});
