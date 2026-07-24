import { describe, expect, it } from 'vitest';

import { computeCommonDirectory } from './compute-common-directory.js';

describe('computeCommonDirectory', () => {
	it('同一ディレクトリ配下のURL群から共通ディレクトリを1つ返す', () => {
		const result = computeCommonDirectory([
			'https://example.com/recruit/2026/entry',
			'https://example.com/recruit/2026/faq',
		]);

		expect(result).toEqual(['https://example.com/recruit/2026/']);
	});

	it('末尾スラッシュ付きURLと無しURLが混在しても正しく共通ディレクトリを計算する', () => {
		const result = computeCommonDirectory([
			'https://example.com/recruit/2026/',
			'https://example.com/recruit/2026/entry',
		]);

		expect(result).toEqual(['https://example.com/recruit/2026/']);
	});

	it('共通セグメントがルート以外に無い場合はオリジン直下を返す', () => {
		const result = computeCommonDirectory([
			'https://example.com/recruit/entry',
			'https://example.com/news/article',
		]);

		expect(result).toEqual(['https://example.com/']);
	});

	it('単一ページのみの場合はそのページ自身のディレクトリを返す（ファイル名は含まない）', () => {
		const result = computeCommonDirectory(['https://example.com/recruit/2026/entry']);

		expect(result).toEqual(['https://example.com/recruit/2026/']);
	});

	it('空配列の場合は空配列を返す', () => {
		const result = computeCommonDirectory([]);

		expect(result).toEqual([]);
	});

	it('複数ホストが混在する場合はホストごとに共通ディレクトリを返す', () => {
		const result = computeCommonDirectory([
			'https://example.com/recruit/2026/entry',
			'https://example.com/recruit/2026/faq',
			'https://example.jp/recruit/2026/entry',
			'https://example.jp/recruit/2026/faq',
		]);

		expect(result).toEqual([
			'https://example.com/recruit/2026/',
			'https://example.jp/recruit/2026/',
		]);
	});

	it('ポート番号が異なる場合は別ホストとして扱う', () => {
		const result = computeCommonDirectory([
			'https://example.com:8080/recruit/entry',
			'https://example.com:8080/recruit/faq',
			'https://example.com/recruit/entry',
		]);

		expect(result).toEqual([
			'https://example.com/recruit/',
			'https://example.com:8080/recruit/',
		]);
	});

	it('同一ホストでもschemeが異なる場合は別オリジンとして扱う', () => {
		const result = computeCommonDirectory([
			'http://example.com/recruit/entry',
			'https://example.com/recruit/faq',
		]);

		expect(result).toEqual([
			'http://example.com/recruit/',
			'https://example.com/recruit/',
		]);
	});

	it('ルートページのみの場合はオリジン直下を返す', () => {
		const result = computeCommonDirectory(['https://example.com/']);

		expect(result).toEqual(['https://example.com/']);
	});
});
