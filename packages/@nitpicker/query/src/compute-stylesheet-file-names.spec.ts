import { describe, expect, it } from 'vitest';

import { computeStylesheetFileNames } from './compute-stylesheet-file-names.js';

describe('computeStylesheetFileNames', () => {
	it('URLからファイル名（拡張子付き）を抽出する', () => {
		const result = computeStylesheetFileNames(['https://example.com/assets/common.css']);

		expect(result).toEqual(['common.css']);
	});

	it('クエリ文字列を除いたファイル名を抽出する', () => {
		const result = computeStylesheetFileNames(['https://example.com/style.css?v=1']);

		expect(result).toEqual(['style.css']);
	});

	it('クエリ文字列のみが異なる同名ファイルは重複除去される', () => {
		const result = computeStylesheetFileNames([
			'https://example.com/style.css?v=1',
			'https://example.com/theme/style.css?v=2',
		]);

		expect(result).toEqual(['style.css']);
	});

	it('異なるファイル名は両方保持される', () => {
		const result = computeStylesheetFileNames([
			'https://example.com/a.css',
			'https://example.com/b.css',
		]);

		expect(result).toEqual(['a.css', 'b.css']);
	});

	it('空配列を渡すと空配列を返す', () => {
		const result = computeStylesheetFileNames([]);

		expect(result).toEqual([]);
	});
});
