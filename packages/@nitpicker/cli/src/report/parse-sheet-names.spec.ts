import { describe, it, expect } from 'vitest';

import { parseSheetNames } from './parse-sheet-names.js';

describe('parseSheetNames', () => {
	it('単一のエイリアスを正式なシート名に解決する', () => {
		expect(parseSheetNames('pages')).toStrictEqual(['Page List']);
	});

	it('カンマ区切りの複数エイリアスを順序を保って解決する', () => {
		expect(parseSheetNames('pages,links,resources,referrers-rel-table')).toStrictEqual([
			'Page List',
			'Links',
			'Resources',
			'Referrers Relational Table',
		]);
	});

	it('page-list と pagelist はどちらも Page List に解決する', () => {
		expect(parseSheetNames('page-list')).toStrictEqual(['Page List']);
		expect(parseSheetNames('pagelist')).toStrictEqual(['Page List']);
	});

	it('referrers-relational-table と referrers-rel-table はどちらも同じシートに解決する', () => {
		expect(parseSheetNames('referrers-relational-table')).toStrictEqual([
			'Referrers Relational Table',
		]);
		expect(parseSheetNames('referrers-rel-table')).toStrictEqual([
			'Referrers Relational Table',
		]);
	});

	it('resources-relational-table と resources-rel-table はどちらも同じシートに解決する', () => {
		expect(parseSheetNames('resources-relational-table')).toStrictEqual([
			'Resources Relational Table',
		]);
		expect(parseSheetNames('resources-rel-table')).toStrictEqual([
			'Resources Relational Table',
		]);
	});

	it('violations・discrepancies・images・summary をそれぞれ解決する', () => {
		expect(parseSheetNames('violations')).toStrictEqual(['Violations']);
		expect(parseSheetNames('discrepancies')).toStrictEqual(['Discrepancies']);
		expect(parseSheetNames('images')).toStrictEqual(['Images']);
		expect(parseSheetNames('summary')).toStrictEqual(['Summary']);
	});

	it('大文字小文字を無視してエイリアスを解決する', () => {
		expect(parseSheetNames('PAGES,Links')).toStrictEqual(['Page List', 'Links']);
	});

	it('正式なシート名の完全一致もそのまま解決する（大文字小文字無視）', () => {
		expect(parseSheetNames('Page List')).toStrictEqual(['Page List']);
		expect(parseSheetNames('page list')).toStrictEqual(['Page List']);
	});

	it('各エントリの前後の空白をトリムする', () => {
		expect(parseSheetNames(' pages , links ')).toStrictEqual(['Page List', 'Links']);
	});

	it('未知の名前が含まれる場合、その値を含むエラーを投げる', () => {
		expect(() => parseSheetNames('pages,not-a-sheet')).toThrow(
			'Unknown sheet name: "not-a-sheet"',
		);
	});

	it('未知の名前のエラーメッセージに有効な名前とエイリアスの一覧を含める', () => {
		expect(() => parseSheetNames('bogus')).toThrow(
			/Valid names:.*Page List.*aliases:.*pages/s,
		);
	});

	it('同じシート名を複数回指定すると、そのまま重複して返す（呼び出し側の責務）', () => {
		expect(parseSheetNames('pages,pages')).toStrictEqual(['Page List', 'Page List']);
	});

	it('空文字列を渡すとエラーを投げる', () => {
		expect(() => parseSheetNames('')).toThrow('Unknown sheet name: ""');
	});

	it('末尾のカンマによる空エントリでエラーを投げる', () => {
		expect(() => parseSheetNames('pages,')).toThrow('Unknown sheet name: ""');
	});
});
