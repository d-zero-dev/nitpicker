import { describe, it, expect } from 'vitest';

import { mapFlagsToCrawlConfig } from './map-flags-to-crawl-config.js';

describe('mapFlagsToCrawlConfig', () => {
	it('exclude を excludes にマッピングする', () => {
		const result = mapFlagsToCrawlConfig({
			exclude: ['/secret/*', '/admin/*'],
		});
		expect(result.excludes).toEqual(['/secret/*', '/admin/*']);
	});

	it('excludeKeyword を excludeKeywords にマッピングする', () => {
		const result = mapFlagsToCrawlConfig({
			excludeKeyword: ['FORBIDDEN', '/Error/i'],
		});
		expect(result.excludeKeywords).toEqual(['FORBIDDEN', '/Error/i']);
	});

	it('excludeUrl を excludeUrls にマッピングする', () => {
		const result = mapFlagsToCrawlConfig({
			excludeUrl: ['https://example.com/skip'],
		});
		expect(result.excludeUrls).toEqual(['https://example.com/skip']);
	});

	it('scope をカンマ区切りで配列に変換する', () => {
		const result = mapFlagsToCrawlConfig({
			scope: 'www.example.com, blog.example.com , api.example.com',
		});
		expect(result.scope).toEqual([
			'www.example.com',
			'blog.example.com',
			'api.example.com',
		]);
	});

	it('scope のカンマ区切りで空文字列をフィルタリングする', () => {
		const result = mapFlagsToCrawlConfig({
			scope: 'a,,b',
		});
		expect(result.scope).toEqual(['a', 'b']);
	});

	it('scope のカンマ区切りで空白のみの要素をフィルタリングする', () => {
		const result = mapFlagsToCrawlConfig({
			scope: 'a, , ,b',
		});
		expect(result.scope).toEqual(['a', 'b']);
	});

	it('scope が全て空文字列の場合、空配列を返す', () => {
		const result = mapFlagsToCrawlConfig({
			scope: ',,,',
		});
		expect(result.scope).toEqual([]);
	});

	it('scope が未指定の場合 undefined を返す', () => {
		const result = mapFlagsToCrawlConfig({});
		expect(result.scope).toBeUndefined();
	});

	it('CrawlConfig に直接対応するフラグをそのまま渡す', () => {
		const result = mapFlagsToCrawlConfig({
			interval: 500,
			image: false,
			fetchExternal: true,
			parallels: 4,
			recursive: false,
			disableQueries: true,
			imageFileSizeThreshold: 1024,
			maxExcludedDepth: 5,
			retry: 2,
			userAgent: 'TestBot/1.0',
			ignoreRobots: true,
			verbose: true,
		});

		expect(result.interval).toBe(500);
		expect(result.image).toBe(false);
		expect(result.fetchExternal).toBe(true);
		expect(result.parallels).toBe(4);
		expect(result.recursive).toBe(false);
		expect(result.disableQueries).toBe(true);
		expect(result.imageFileSizeThreshold).toBe(1024);
		expect(result.maxExcludedDepth).toBe(5);
		expect(result.retry).toBe(2);
		expect(result.userAgent).toBe('TestBot/1.0');
		expect(result.ignoreRobots).toBe(true);
		expect(result.verbose).toBe(true);
	});

	it('CLI 専用フラグ (resume, silent, diff, single, listFile, list) が結果に含まれない', () => {
		const flags = {
			exclude: ['/test/*'],
			interval: 100,
		};
		const result = mapFlagsToCrawlConfig(flags);
		const keys = Object.keys(result);

		expect(keys).not.toContain('resume');
		expect(keys).not.toContain('silent');
		expect(keys).not.toContain('diff');
		expect(keys).not.toContain('single');
		expect(keys).not.toContain('listFile');
		expect(keys).not.toContain('list');
		expect(keys).not.toContain('exclude');
		expect(keys).not.toContain('excludeKeyword');
		expect(keys).not.toContain('excludeUrl');
	});

	it('未指定のフラグは undefined として含まれる', () => {
		const result = mapFlagsToCrawlConfig({});

		expect(result.excludes).toBeUndefined();
		expect(result.excludeKeywords).toBeUndefined();
		expect(result.excludeUrls).toBeUndefined();
		expect(result.interval).toBeUndefined();
	});
});
