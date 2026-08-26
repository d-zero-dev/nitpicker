import type { BrowserScrapeResult } from './types.js';
import type { PageData } from '../utils/types/types.js';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { describe, expect, it } from 'vitest';

import { resolveResultWentOffHost } from './resolve-result-went-off-host.js';

const url = parseUrl('https://example.com/page')!;

/**
 * @param overrides - Partial overrides merged into the default mock PageData.
 */
function makePageData(overrides?: Partial<PageData>): PageData {
	return {
		url,
		isTarget: true,
		isExternal: false,
		redirectPaths: [],
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 1000,
		responseHeaders: {},
		meta: { title: 'Test' },
		imageList: [],
		anchorList: [],
		html: '<html></html>',
		isSkipped: false,
		...overrides,
	};
}

describe('resolveResultWentOffHost', () => {
	it('success かつ pageData.isExternal=false のとき false を返す', () => {
		const result: BrowserScrapeResult = {
			type: 'success',
			resources: [],
			consoleLogs: [],
			pageData: makePageData({ isExternal: false }),
		};
		expect(resolveResultWentOffHost(result, url)).toBe(false);
	});

	it('success かつ pageData.isExternal=true のとき true を返す（クロスホストリダイレクト成功時）', () => {
		const result: BrowserScrapeResult = {
			type: 'success',
			resources: [],
			consoleLogs: [],
			pageData: makePageData({ isExternal: true }),
		};
		expect(resolveResultWentOffHost(result, url)).toBe(true);
	});

	it('error かつ postNavigationUrl が同一ホストのとき false を返す', () => {
		const result: BrowserScrapeResult = {
			type: 'error',
			resources: [],
			consoleLogs: [],
			error: { name: 'Error', message: 'boom', shutdown: true },
			postNavigationUrl: 'https://example.com/other-page',
		};
		expect(resolveResultWentOffHost(result, url)).toBe(false);
	});

	it('error かつ postNavigationUrl が別ホストのとき true を返す（クロスホストリダイレクト中のエラー）', () => {
		const result: BrowserScrapeResult = {
			type: 'error',
			resources: [],
			consoleLogs: [],
			error: { name: 'Error', message: 'boom', shutdown: true },
			postNavigationUrl: 'https://other.example/dest',
		};
		expect(resolveResultWentOffHost(result, url)).toBe(true);
	});

	it('error かつ postNavigationUrl が無いとき false を返す（漏洩の証拠が無いため同一ホスト側に倒す）', () => {
		const result: BrowserScrapeResult = {
			type: 'error',
			resources: [],
			consoleLogs: [],
			error: { name: 'Error', message: 'boom', shutdown: true },
		};
		expect(resolveResultWentOffHost(result, url)).toBe(false);
	});

	it('error かつ postNavigationUrl がパース不能なとき true を返す（ホスト不明を安全側＝破棄に倒す）', () => {
		const result: BrowserScrapeResult = {
			type: 'error',
			resources: [],
			consoleLogs: [],
			error: { name: 'Error', message: 'boom', shutdown: true },
			postNavigationUrl: 'about:blank',
		};
		expect(resolveResultWentOffHost(result, url)).toBe(true);
	});

	it('skipped かつ postNavigationUrl が無いとき false を返す（判定材料が無い既知の残存ギャップ）', () => {
		const result: BrowserScrapeResult = {
			type: 'skipped',
			resources: [],
			consoleLogs: [],
			ignored: { url, matchedText: 'excluded', excludeKeywords: ['excluded'] },
		};
		expect(resolveResultWentOffHost(result, url)).toBe(false);
	});
});
