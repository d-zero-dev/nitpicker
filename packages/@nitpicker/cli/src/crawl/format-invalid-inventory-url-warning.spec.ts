import { describe, it, expect } from 'vitest';

import { formatInvalidInventoryUrlWarning } from './format-invalid-inventory-url-warning.js';

describe('formatInvalidInventoryUrlWarning', () => {
	it('リストファイル名・行・列・不正な値を含むメッセージを組み立てる', () => {
		const message = formatInvalidInventoryUrlWarning('urls.txt', {
			value: 'not-a-url',
			line: 3,
			column: 1,
		});
		expect(message).toBe(
			'[nitpicker] inventory list: skipping invalid URL at urls.txt:3:1 — "not-a-url"',
		);
	});

	it('解決済みの絶対パスではなく、オペレータが入力した文字列をそのまま使う', () => {
		const message = formatInvalidInventoryUrlWarning('./relative/urls.txt', {
			value: 'bad',
			line: 1,
			column: 1,
		});
		expect(message).toContain('./relative/urls.txt');
	});

	it('column が 1 以外でも正しく反映する', () => {
		const message = formatInvalidInventoryUrlWarning('urls.txt', {
			value: 'bad',
			line: 5,
			column: 3,
		});
		expect(message).toContain('urls.txt:5:3');
	});

	it('200文字を超える行は末尾を省略記号で切り詰める', () => {
		const longValue = 'x'.repeat(250);
		const message = formatInvalidInventoryUrlWarning('urls.txt', {
			value: longValue,
			line: 1,
			column: 1,
		});
		expect(message).toContain(`"${'x'.repeat(200)}…"`);
		expect(message).not.toContain(longValue);
	});

	it('200文字以下の行は切り詰めない', () => {
		const value = 'x'.repeat(200);
		const message = formatInvalidInventoryUrlWarning('urls.txt', {
			value,
			line: 1,
			column: 1,
		});
		expect(message).toContain(`"${value}"`);
	});
});
