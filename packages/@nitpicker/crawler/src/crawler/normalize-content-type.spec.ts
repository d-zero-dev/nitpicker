import { describe, expect, it } from 'vitest';

import { normalizeContentType } from './normalize-content-type.js';

describe('normalizeContentType', () => {
	it('null はそのまま null', () => {
		expect(normalizeContentType(null)).toBeNull();
	});

	it('既に正規形ならそのまま返す', () => {
		expect(normalizeContentType('text/html')).toBe('text/html');
		expect(normalizeContentType('application/pdf')).toBe('application/pdf');
	});

	it('大文字は小文字化する', () => {
		expect(normalizeContentType('Text/HTML')).toBe('text/html');
		expect(normalizeContentType('APPLICATION/PDF')).toBe('application/pdf');
	});

	it('前後の空白を除去する', () => {
		expect(normalizeContentType('text/html ')).toBe('text/html');
		expect(normalizeContentType('  text/html')).toBe('text/html');
	});

	it('空白のみ・空文字は null にする', () => {
		expect(normalizeContentType('   ')).toBeNull();
		expect(normalizeContentType('')).toBeNull();
	});
});
