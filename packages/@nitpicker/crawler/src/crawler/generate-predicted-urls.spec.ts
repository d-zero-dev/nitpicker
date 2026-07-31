import { describe, expect, it } from 'vitest';

import { generatePredictedUrls } from './generate-predicted-urls.js';

describe('generatePredictedUrls', () => {
	it('step=1, count=3 で3つのURLを生成する', () => {
		const pattern = { tokenIndex: 1, step: 1, currentNumber: 3 };
		const urls = generatePredictedUrls(pattern, '//example.com/page/3', 3);
		expect(urls).toEqual([
			'//example.com/page/4',
			'//example.com/page/5',
			'//example.com/page/6',
		]);
	});

	it('step=10, count=2 で2つのURLを生成する', () => {
		const pattern = { tokenIndex: 1, step: 10, currentNumber: 20 };
		const urls = generatePredictedUrls(pattern, '//example.com/page/20', 2);
		expect(urls).toEqual(['//example.com/page/30', '//example.com/page/40']);
	});

	it('クエリパターンのURLを生成する', () => {
		const pattern = { tokenIndex: 1, step: 1, currentNumber: 2 };
		const urls = generatePredictedUrls(pattern, '//example.com/list?p=2&sort=name', 2);
		expect(urls).toEqual([
			'//example.com/list?p=3&sort=name',
			'//example.com/list?p=4&sort=name',
		]);
	});

	it('count=0 で空配列を返す', () => {
		const pattern = { tokenIndex: 1, step: 1, currentNumber: 3 };
		const urls = generatePredictedUrls(pattern, '//example.com/page/3', 0);
		expect(urls).toEqual([]);
	});

	it('深いパスのURLを生成する', () => {
		const pattern = { tokenIndex: 2, step: 1, currentNumber: 3 };
		const urls = generatePredictedUrls(pattern, '//example.com/a/b/3/c', 2);
		expect(urls).toEqual(['//example.com/a/b/4/c', '//example.com/a/b/5/c']);
	});

	it('ゼロ埋め幅を保つ', () => {
		const pattern = { tokenIndex: 1, step: 1, currentNumber: 1 };
		const urls = generatePredictedUrls(pattern, '//example.com/page/01', 2);
		expect(urls).toEqual(['//example.com/page/02', '//example.com/page/03']);
	});

	it('元トークンの桁数+1を超えるトークンは生成せず打ち切る', () => {
		const pattern = { tokenIndex: 1, step: 90, currentNumber: 9 };
		const urls = generatePredictedUrls(pattern, '//example.com/page/9', 3);
		// i=1: 99 (2桁, 元の1桁+1まで許容) → 生成
		// i=2: 189 (3桁) → 桁数超過で打ち切り、以降は生成しない
		expect(urls).toEqual(['//example.com/page/99']);
	});

	it('safe integer を超えるトークンは生成せず打ち切る', () => {
		const pattern = {
			tokenIndex: 1,
			step: Number.MAX_SAFE_INTEGER,
			currentNumber: Number.MAX_SAFE_INTEGER,
		};
		const urls = generatePredictedUrls(pattern, '//example.com/page/9007199254740991', 5);
		expect(urls).toEqual([]);
	});

	it('報告された 1.7715854126052197e+120 形状は生成不可能である（回帰テスト）', () => {
		// 実際の trap は「無関係な2ページ由来のURL比較で step が毎ラウンド倍化する」
		// ことで生じたが、この関数はその暴走の最終出力段（数値→トークン文字列化）を
		// 担うため、ここで科学表記の出力自体を構造的に禁止することが最後の砦になる。
		const pattern = {
			tokenIndex: 2,
			step: 1e100,
			currentNumber: 1.771_585_412_605_219_7e100,
		};
		const urls = generatePredictedUrls(pattern, '//example.com/news/date/2024/', 10);
		for (const url of urls) {
			expect(url).not.toMatch(/e[+-]\d+/i);
		}
		// safe integer を最初の反復で超えるため実際には全て空になる
		expect(urls).toEqual([]);
	});
});
