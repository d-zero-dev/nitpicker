import { describe, expect, it } from 'vitest';

import { computeDirectoryDistribution } from './compute-directory-distribution.js';

describe('computeDirectoryDistribution', () => {
	it('第一階層のディレクトリごとにページ数を集計する', () => {
		const result = computeDirectoryDistribution([
			'https://example.com/recruit/fresh',
			'https://example.com/recruit/mid-career',
			'https://example.com/business/',
		]);

		expect(result).toEqual([
			{ directory: 'https://example.com/recruit/', pageCount: 2 },
			{ directory: 'https://example.com/business/', pageCount: 1 },
		]);
	});

	it('ページ数の降順でソートする', () => {
		const result = computeDirectoryDistribution([
			'https://example.com/a/1',
			'https://example.com/b/1',
			'https://example.com/b/2',
			'https://example.com/b/3',
		]);

		expect(result).toEqual([
			{ directory: 'https://example.com/b/', pageCount: 3 },
			{ directory: 'https://example.com/a/', pageCount: 1 },
		]);
	});

	it('ページ数が同数の場合はディレクトリURLの昇順でタイブレークする', () => {
		const result = computeDirectoryDistribution([
			'https://example.com/b/1',
			'https://example.com/a/1',
		]);

		expect(result).toEqual([
			{ directory: 'https://example.com/a/', pageCount: 1 },
			{ directory: 'https://example.com/b/', pageCount: 1 },
		]);
	});

	it('topNを超える件数がある場合は上位のみ返す', () => {
		const result = computeDirectoryDistribution(
			['https://example.com/a/1', 'https://example.com/b/1', 'https://example.com/c/1'],
			2,
		);

		expect(result).toHaveLength(2);
		expect(result).toEqual([
			{ directory: 'https://example.com/a/', pageCount: 1 },
			{ directory: 'https://example.com/b/', pageCount: 1 },
		]);
	});

	it('ルート直下のページはオリジン自体に集計される', () => {
		const result = computeDirectoryDistribution([
			'https://example.com/',
			'https://example.com/about',
		]);

		expect(result).toEqual([{ directory: 'https://example.com/', pageCount: 2 }]);
	});

	it('複数ホストが混在する場合はホストごとに集計する', () => {
		const result = computeDirectoryDistribution([
			'https://example.com/recruit/entry',
			'https://example.jp/recruit/entry',
		]);

		expect(result).toEqual([
			{ directory: 'https://example.com/recruit/', pageCount: 1 },
			{ directory: 'https://example.jp/recruit/', pageCount: 1 },
		]);
	});

	it('空配列の場合は空配列を返す', () => {
		const result = computeDirectoryDistribution([]);

		expect(result).toEqual([]);
	});
});
