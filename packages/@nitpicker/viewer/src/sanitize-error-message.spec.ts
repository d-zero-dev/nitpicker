import { describe, expect, it } from 'vitest';

import { sanitizeErrorMessage } from './sanitize-error-message.js';

describe('sanitizeErrorMessage', () => {
	it('絶対パスを <path> に置換する', () => {
		expect(sanitizeErrorMessage('Failed to read /Users/foo/bar/baz.ts here')).toBe(
			'Failed to read <path> here',
		);
	});

	it('パスを含まないメッセージはそのまま返す', () => {
		expect(sanitizeErrorMessage('Page not found')).toBe('Page not found');
	});

	it('単一セグメントのパスは置換しない', () => {
		expect(sanitizeErrorMessage('see /tmp')).toBe('see /tmp');
	});
});
