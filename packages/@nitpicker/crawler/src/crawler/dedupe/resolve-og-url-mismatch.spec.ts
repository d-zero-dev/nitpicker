import type { Meta } from '@d-zero/beholder';

import { describe, expect, it } from 'vitest';

import { resolveOgUrlMismatch } from './resolve-og-url-mismatch.js';

/**
 *
 * @param ogUrl
 */
function buildMeta(ogUrl: string | undefined): Meta {
	return { title: '', og: { url: ogUrl } } as Meta;
}

describe('resolveOgUrlMismatch', () => {
	it('og:urlが無ければfalse（シグナルなし）', () => {
		expect(resolveOgUrlMismatch(buildMeta(), 'https://example.com/news/date/2024/')).toBe(
			false,
		);
	});

	it('og:urlが親一覧を指していればtrue', () => {
		expect(
			resolveOgUrlMismatch(buildMeta('/news'), 'https://example.com/news/date/2024/'),
		).toBe(true);
	});

	it('og:urlが絶対URLで自分自身と一致すればfalse', () => {
		expect(
			resolveOgUrlMismatch(
				buildMeta('https://example.com/news/date/2024/'),
				'https://example.com/news/date/2024/',
			),
		).toBe(false);
	});

	it('相対URLの自己参照は絶対化してから比較し、一致すればfalse', () => {
		expect(resolveOgUrlMismatch(buildMeta('./'), 'https://example.com/')).toBe(false);
	});

	it('不正なog:urlはfalse（シグナルなし）', () => {
		expect(
			resolveOgUrlMismatch(buildMeta('http://[::not-valid'), 'https://example.com/'),
		).toBe(false);
	});
});
