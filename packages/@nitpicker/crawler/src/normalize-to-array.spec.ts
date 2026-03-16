import { describe, it, expect } from 'vitest';

import { normalizeToArray } from './normalize-to-array.js';

describe('normalizeToArray', () => {
	it('null を空配列に変換する', () => {
		expect(normalizeToArray(null)).toEqual([]);
	});

	it('undefined を空配列に変換する', () => {
		expect(normalizeToArray()).toEqual([]);
	});

	it('空文字列を空配列に変換する', () => {
		expect(normalizeToArray('')).toEqual([]);
	});

	it('単一文字列を1要素の配列に変換する', () => {
		expect(normalizeToArray('/blog/**/*')).toEqual(['/blog/**/*']);
	});

	it('カンマ区切りの文字列を分割する', () => {
		expect(normalizeToArray('/blog/**/*,/facility/**/*')).toEqual([
			'/blog/**/*',
			'/facility/**/*',
		]);
	});

	it('カンマ区切りの前後の空白をトリムする', () => {
		expect(normalizeToArray('/blog/**/* , /facility/**/*')).toEqual([
			'/blog/**/*',
			'/facility/**/*',
		]);
	});

	it('配列をそのまま返す', () => {
		expect(normalizeToArray(['/blog/**/*', '/facility/**/*'])).toEqual([
			'/blog/**/*',
			'/facility/**/*',
		]);
	});

	it('配列内のカンマ区切り文字列も分割する', () => {
		expect(normalizeToArray(['/blog/**/*,/facility/**/*', '/admin/*'])).toEqual([
			'/blog/**/*',
			'/facility/**/*',
			'/admin/*',
		]);
	});

	it('空要素を除去する', () => {
		expect(normalizeToArray(',/blog/**/*,,/facility/**/*,')).toEqual([
			'/blog/**/*',
			'/facility/**/*',
		]);
	});

	it('ブレース展開内のカンマでは分割しない', () => {
		expect(normalizeToArray('/blog/*.{html,php},/facility/**/*')).toEqual([
			'/blog/*.{html,php}',
			'/facility/**/*',
		]);
	});

	it('ネストしたブレース展開内のカンマでも分割しない', () => {
		expect(normalizeToArray('/blog/*.{html,{js,ts}},/admin/*')).toEqual([
			'/blog/*.{html,{js,ts}}',
			'/admin/*',
		]);
	});

	it('閉じブレースがない場合でもブレース内のカンマでは分割しない', () => {
		expect(normalizeToArray('/blog/*.{html,php')).toEqual(['/blog/*.{html,php']);
	});

	it('開きブレースがない閉じブレースはトップレベルとして扱う', () => {
		expect(normalizeToArray('/blog/*.html},/admin/*')).toEqual([
			'/blog/*.html}',
			'/admin/*',
		]);
	});
});
