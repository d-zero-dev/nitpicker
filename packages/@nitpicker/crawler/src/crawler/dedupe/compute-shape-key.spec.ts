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
});
