import { describe, expect, it } from 'vitest';

import { detectPaginationPattern } from './detect-pagination-pattern.js';

describe('detectPaginationPattern', () => {
	describe('正常検出ケース', () => {
		it('パスセグメントの数値差異を検出する', () => {
			const result = detectPaginationPattern(
				'//example.com/page/2',
				'//example.com/page/3',
			);
			expect(result).toEqual({ tokenIndex: 1, step: 1, currentNumber: 3 });
		});

		it('末尾パスの数値差異を検出する', () => {
			const result = detectPaginationPattern(
				'//example.com/blog/2',
				'//example.com/blog/3',
			);
			expect(result).toEqual({ tokenIndex: 1, step: 1, currentNumber: 3 });
		});

		it('深いパスの数値差異を検出する', () => {
			const result = detectPaginationPattern(
				'//example.com/a/b/2/c',
				'//example.com/a/b/3/c',
			);
			expect(result).toEqual({ tokenIndex: 2, step: 1, currentNumber: 3 });
		});

		it('クエリパラメータの数値差異を検出する', () => {
			const result = detectPaginationPattern(
				'//example.com/list?p=1&sort=name',
				'//example.com/list?p=2&sort=name',
			);
			expect(result).toEqual({ tokenIndex: 1, step: 1, currentNumber: 2 });
		});

		it('step > 1 を検出する', () => {
			const result = detectPaginationPattern(
				'//example.com/page/10',
				'//example.com/page/20',
			);
			expect(result).toEqual({ tokenIndex: 1, step: 10, currentNumber: 20 });
		});

		it('0始まりページネーションを検出する', () => {
			const result = detectPaginationPattern(
				'//example.com/page/0',
				'//example.com/page/1',
			);
			expect(result).toEqual({ tokenIndex: 1, step: 1, currentNumber: 1 });
		});

		it('大きい数値でも検出する', () => {
			const result = detectPaginationPattern(
				'//example.com/items/100',
				'//example.com/items/101',
			);
			expect(result).toEqual({ tokenIndex: 1, step: 1, currentNumber: 101 });
		});

		it('ポート付きURLを検出する', () => {
			const result = detectPaginationPattern(
				'//example.com:8080/page/1',
				'//example.com:8080/page/2',
			);
			expect(result).toEqual({ tokenIndex: 1, step: 1, currentNumber: 2 });
		});

		it('クエリのみ（パスなし）を検出する', () => {
			const result = detectPaginationPattern(
				'//example.com?offset=0',
				'//example.com?offset=10',
			);
			expect(result).toEqual({ tokenIndex: 0, step: 10, currentNumber: 10 });
		});
	});

	describe('null を返すケース', () => {
		it('ホスト名が異なる場合', () => {
			expect(
				detectPaginationPattern('//example.com/page/2', '//other.com/page/3'),
			).toBeNull();
		});

		it('パスの長さが異なる場合', () => {
			expect(
				detectPaginationPattern('//example.com/page/2', '//example.com/page/2/extra'),
			).toBeNull();
		});

		it('非数値の差異がある場合', () => {
			expect(
				detectPaginationPattern('//example.com/page/a', '//example.com/page/b'),
			).toBeNull();
		});

		it('複数箇所の数値差異がある場合', () => {
			expect(
				detectPaginationPattern('//example.com/1/page/2', '//example.com/2/page/3'),
			).toBeNull();
		});

		it('数値 + 非数値の差異がある場合', () => {
			expect(
				detectPaginationPattern('//example.com/a/2', '//example.com/b/3'),
			).toBeNull();
		});

		it('step が 0（同一URL）の場合', () => {
			expect(
				detectPaginationPattern('//example.com/page/3', '//example.com/page/3'),
			).toBeNull();
		});

		it('step が負（デクリメント）の場合', () => {
			expect(
				detectPaginationPattern('//example.com/page/5', '//example.com/page/3'),
			).toBeNull();
		});

		it('クエリのキーセットが異なる場合', () => {
			expect(
				detectPaginationPattern(
					'//example.com/list?p=1&a=x',
					'//example.com/list?p=2&b=y',
				),
			).toBeNull();
		});

		it('クエリのキー数が異なる場合', () => {
			expect(
				detectPaginationPattern(
					'//example.com/list?p=1',
					'//example.com/list?p=2&extra=1',
				),
			).toBeNull();
		});

		it('プロトコル以外完全一致（数値差異なし）の場合', () => {
			expect(
				detectPaginationPattern('//example.com/about', '//example.com/about'),
			).toBeNull();
		});

		it('空パス同士の場合', () => {
			expect(detectPaginationPattern('//example.com', '//example.com')).toBeNull();
		});
	});

	describe('境界値ケース', () => {
		it('非常に大きな数値でも動作する', () => {
			const result = detectPaginationPattern(
				'//example.com/page/999999',
				'//example.com/page/1000000',
			);
			expect(result).toEqual({ tokenIndex: 1, step: 1, currentNumber: 1_000_000 });
		});

		it('パス内に固定数値セグメントがあっても変化箇所のみ検出する', () => {
			const result = detectPaginationPattern(
				'//example.com/v2/page/3',
				'//example.com/v2/page/4',
			);
			expect(result).toEqual({ tokenIndex: 2, step: 1, currentNumber: 4 });
		});
	});
});
