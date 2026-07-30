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
			mainContentSelector: '#main',
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
		expect(result.mainContentSelector).toBe('#main');
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

	it('dedupeCap を指定した値のままマッピングする', () => {
		const result = mapFlagsToCrawlConfig({ dedupeCap: 100 });
		expect(result.dedupeCap).toBe(100);
	});

	it('dedupeCap 未指定は null（無効化）にマッピングする', () => {
		const result = mapFlagsToCrawlConfig({});
		expect(result.dedupeCap).toBeNull();
	});

	it('dedupeMapCap を指定した値のままマッピングする', () => {
		const result = mapFlagsToCrawlConfig({ dedupeMapCap: 50_000 });
		expect(result.dedupeMapCap).toBe(50_000);
	});
});
