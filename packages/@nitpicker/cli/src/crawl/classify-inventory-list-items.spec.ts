import { describe, it, expect } from 'vitest';

import { classifyInventoryListItems } from './classify-inventory-list-items.js';

describe('classifyInventoryListItems', () => {
	it('パース可能な URL を valid に振り分ける', () => {
		const result = classifyInventoryListItems([
			{ value: 'https://example.com/', line: 1, column: 1 },
			{ value: 'https://example.com/about', line: 2, column: 1 },
		]);
		expect(result.valid).toEqual(['https://example.com/', 'https://example.com/about']);
		expect(result.invalid).toEqual([]);
	});

	it('URL としてパースできない行を invalid に振り分け、位置情報を保持する', () => {
		const result = classifyInventoryListItems([
			{ value: 'https://example.com/', line: 1, column: 1 },
			{ value: 'not-a-url', line: 3, column: 1 },
		]);
		expect(result.valid).toEqual(['https://example.com/']);
		expect(result.invalid).toEqual([{ value: 'not-a-url', line: 3, column: 1 }]);
	});

	it('valid / invalid ともに入力順序を保持する', () => {
		const result = classifyInventoryListItems([
			{ value: 'bad-1', line: 1, column: 1 },
			{ value: 'https://example.com/a', line: 2, column: 1 },
			{ value: 'bad-2', line: 3, column: 1 },
			{ value: 'https://example.com/b', line: 4, column: 1 },
		]);
		expect(result.valid).toEqual(['https://example.com/a', 'https://example.com/b']);
		expect(result.invalid.map((item) => item.value)).toEqual(['bad-1', 'bad-2']);
	});

	it('空配列を渡すと valid / invalid ともに空配列を返す', () => {
		expect(classifyInventoryListItems([])).toEqual({ valid: [], invalid: [] });
	});

	it('全行が invalid な場合、valid は空配列になる', () => {
		const result = classifyInventoryListItems([
			{ value: 'not-a-url', line: 1, column: 1 },
			{ value: 'also not a url', line: 2, column: 1 },
		]);
		expect(result.valid).toEqual([]);
		expect(result.invalid).toHaveLength(2);
	});
});
