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
});
