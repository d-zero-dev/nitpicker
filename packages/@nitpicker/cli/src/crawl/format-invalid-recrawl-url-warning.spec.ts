import { describe, it, expect } from 'vitest';

import { formatInvalidRecrawlUrlWarning } from './format-invalid-recrawl-url-warning.js';

describe('formatInvalidRecrawlUrlWarning', () => {
	it('リストファイル名・行・列・不正な値を含むメッセージを組み立てる', () => {
		const message = formatInvalidRecrawlUrlWarning('urls.txt', {
			value: 'not-a-url',
			line: 3,
			column: 1,
		});
		expect(message).toBe(
			'[nitpicker] recrawl list: skipping invalid URL at urls.txt:3:1 — "not-a-url"',
		);
	});

	it('解決済みの絶対パスではなく、オペレータが入力した文字列をそのまま使う', () => {
		const message = formatInvalidRecrawlUrlWarning('./relative/urls.txt', {
			value: 'bad',
			line: 1,
			column: 1,
		});
		expect(message).toContain('./relative/urls.txt');
	});

	it('200文字を超える行は末尾を省略記号で切り詰める', () => {
		const longValue = 'x'.repeat(250);
		const message = formatInvalidRecrawlUrlWarning('urls.txt', {
			value: longValue,
			line: 1,
			column: 1,
		});
		expect(message).toContain(`"${'x'.repeat(200)}…"`);
		expect(message).not.toContain(longValue);
	});
});
