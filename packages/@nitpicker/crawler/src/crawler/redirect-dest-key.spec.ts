import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, expect, it } from 'vitest';

import { redirectDestKey } from './redirect-dest-key.js';

describe('redirectDestKey', () => {
	it('リダイレクトが無い場合は元URLのキーを返す', () => {
		const url = parseUrl('http://localhost/page')!;
		expect(redirectDestKey(url, [])).toBe('//localhost/page');
	});

	it('リダイレクトがある場合はチェーン末尾（最終到達先）のキーを返す', () => {
		const url = parseUrl('http://localhost/old')!;
		expect(redirectDestKey(url, ['http://localhost/new'])).toBe('//localhost/new');
	});

	it('多段リダイレクトでも最後のホップを宛先として使う', () => {
		const url = parseUrl('http://localhost/start')!;
		expect(
			redirectDestKey(url, ['http://localhost/middle', 'http://localhost/dest']),
		).toBe('//localhost/dest');
	});

	it('http と https の宛先は同じキーに収束する（protocol-agnostic）', () => {
		const url = parseUrl('http://localhost/old')!;
		const httpsKey = redirectDestKey(url, ['https://localhost/new']);
		const httpKey = redirectDestKey(url, ['http://localhost/new']);
		expect(httpsKey).toBe(httpKey);
	});

	it('宛先のハッシュ・認証情報はキーから除外される', () => {
		const url = parseUrl('http://localhost/old')!;
		expect(redirectDestKey(url, ['http://user:pass@localhost/new#frag'])).toBe(
			'//localhost/new',
		);
	});
});
