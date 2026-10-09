import { describe, expect, it } from 'vitest';

import { resolveRedirectChain } from './resolve-redirect-chain.js';

describe('resolveRedirectChain', () => {
	it('リダイレクトが無い場合は宛先=元URL・sources は空', () => {
		const result = resolveRedirectChain('http://localhost/page', []);
		expect(result).toEqual({ destUrl: 'http://localhost/page', sources: [] });
	});

	it('単一ホップは宛先=最終URL・sources=[元URL]', () => {
		const result = resolveRedirectChain('http://localhost/old', ['http://localhost/new']);
		expect(result).toEqual({
			destUrl: 'http://localhost/new',
			sources: ['http://localhost/old'],
		});
	});

	it('多段ホップは最後を宛先・元URL＋中間ホップを sources にする', () => {
		const result = resolveRedirectChain('http://localhost/start', [
			'http://localhost/middle',
			'http://localhost/dest',
		]);
		expect(result).toEqual({
			destUrl: 'http://localhost/dest',
			sources: ['http://localhost/start', 'http://localhost/middle'],
		});
	});

	it('入力の redirectPaths を破壊しない', () => {
		const paths = ['http://localhost/a', 'http://localhost/b'];
		resolveRedirectChain('http://localhost/start', paths);
		expect(paths).toEqual(['http://localhost/a', 'http://localhost/b']);
	});
});
