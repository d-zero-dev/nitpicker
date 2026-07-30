import { describe, expect, it } from 'vitest';

import { computeCssIntersection } from './compute-css-intersection.js';

describe('computeCssIntersection', () => {
	it('全ページ共通のCSS URLを返す', () => {
		const result = computeCssIntersection([
			['https://example.com/a.css', 'https://example.com/shared.css'],
			['https://example.com/a.css', 'https://example.com/shared.css'],
		]);

		expect(result).toEqual([
			'https://example.com/a.css',
			'https://example.com/shared.css',
		]);
	});

	it('一部のページにしか無いCSS URLは含まれない', () => {
		const result = computeCssIntersection([
			['https://example.com/a.css', 'https://example.com/shared.css'],
			['https://example.com/b.css', 'https://example.com/shared.css'],
		]);

		expect(result).toEqual(['https://example.com/shared.css']);
	});

	it('1件でもCSSを持たないページがあれば空配列を返す', () => {
		const result = computeCssIntersection([
			['https://example.com/a.css'],
			[],
			['https://example.com/a.css'],
		]);

		expect(result).toEqual([]);
	});

	it('空配列を渡すと空配列を返す', () => {
		const result = computeCssIntersection([]);

		expect(result).toEqual([]);
	});

	it('1ページのみの場合はそのページのCSS URLをそのまま返す', () => {
		const result = computeCssIntersection([
			['https://example.com/shared.css', 'https://example.com/a.css'],
		]);

		expect(result).toEqual([
			'https://example.com/a.css',
			'https://example.com/shared.css',
		]);
	});

	it('完全に不一致のCSSセットは空配列を返す', () => {
		const result = computeCssIntersection([
			['https://example.com/a.css'],
			['https://example.com/b.css'],
		]);

		expect(result).toEqual([]);
	});
});
