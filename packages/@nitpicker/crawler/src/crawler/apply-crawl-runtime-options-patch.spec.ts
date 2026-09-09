import type { CrawlerOptions } from './types.js';

import { describe, it, expect } from 'vitest';

import { applyCrawlRuntimeOptionsPatch } from './apply-crawl-runtime-options-patch.js';

/**
 * Creates a fresh {@link CrawlerOptions}-shaped object for each test so
 * mutation in one test can never leak into another.
 * @returns A minimal `CrawlerOptions` fixture.
 */
function createOptions(): CrawlerOptions {
	return {
		interval: 0,
		parallels: 1,
		recursive: true,
		fromList: false,
		captureImages: false,
		executablePath: null,
		fetchExternal: false,
		roots: ['https://example.com/'],
		excludes: ['/existing/**'],
		excludeKeywords: ['existing-keyword'],
		excludeUrls: ['https://existing.example/'],
		maxExcludedDepth: 10,
		retry: 3,
		verbose: false,
		disableQueries: false,
	};
}

describe('applyCrawlRuntimeOptionsPatch', () => {
	it('overwrites parallels', () => {
		const options = createOptions();
		const snapshot = applyCrawlRuntimeOptionsPatch(options, { parallels: 4 });
		expect(snapshot.parallels).toBe(4);
		expect(options.parallels).toBe(4);
	});

	it('overwrites interval', () => {
		const options = createOptions();
		const snapshot = applyCrawlRuntimeOptionsPatch(options, { interval: 500 });
		expect(snapshot.interval).toBe(500);
		expect(options.interval).toBe(500);
	});

	it('appends new excludes without dropping existing entries', () => {
		const options = createOptions();
		const snapshot = applyCrawlRuntimeOptionsPatch(options, { excludes: ['/new/**'] });
		expect(snapshot.excludes).toEqual(['/existing/**', '/new/**']);
	});

	it('appends new excludeUrls without dropping existing entries', () => {
		const options = createOptions();
		const snapshot = applyCrawlRuntimeOptionsPatch(options, {
			excludeUrls: ['https://new.example/'],
		});
		expect(snapshot.excludeUrls).toEqual([
			'https://existing.example/',
			'https://new.example/',
		]);
	});

	it('appends new excludeKeywords without dropping existing entries', () => {
		const options = createOptions();
		const snapshot = applyCrawlRuntimeOptionsPatch(options, {
			excludeKeywords: ['new-keyword'],
		});
		expect(snapshot.excludeKeywords).toEqual(['existing-keyword', 'new-keyword']);
	});

	it('drops a duplicate exclude entry instead of appending it twice', () => {
		const options = createOptions();
		const snapshot = applyCrawlRuntimeOptionsPatch(options, {
			excludes: ['/existing/**'],
		});
		expect(snapshot.excludes).toEqual(['/existing/**']);
	});

	it('leaves fields not present in the patch untouched', () => {
		const options = createOptions();
		const snapshot = applyCrawlRuntimeOptionsPatch(options, { parallels: 4 });
		expect(snapshot.interval).toBe(0);
		expect(snapshot.excludes).toEqual(['/existing/**']);
	});

	it('applies multiple fields from a single patch', () => {
		const options = createOptions();
		const snapshot = applyCrawlRuntimeOptionsPatch(options, {
			parallels: 2,
			interval: 100,
			excludes: ['/multi/**'],
		});
		expect(snapshot).toEqual({
			parallels: 2,
			interval: 100,
			excludes: ['/existing/**', '/multi/**'],
			excludeUrls: ['https://existing.example/'],
			excludeKeywords: ['existing-keyword'],
			addedExcludes: ['/multi/**'],
			addedExcludeUrls: [],
			addedExcludeKeywords: [],
		});
	});

	it('throws RangeError for parallels below 1 and leaves options unchanged', () => {
		const options = createOptions();
		expect(() => applyCrawlRuntimeOptionsPatch(options, { parallels: 0 })).toThrow(
			RangeError,
		);
		expect(options.parallels).toBe(1);
	});

	it('throws RangeError for a non-integer parallels', () => {
		const options = createOptions();
		expect(() => applyCrawlRuntimeOptionsPatch(options, { parallels: 1.5 })).toThrow(
			RangeError,
		);
	});

	it('throws RangeError for a parallels value beyond Number.isSafeInteger, even though Number.isInteger would accept it', () => {
		const options = createOptions();
		const unsafe = 2 ** 53;
		expect(Number.isInteger(unsafe)).toBe(true);
		expect(() => applyCrawlRuntimeOptionsPatch(options, { parallels: unsafe })).toThrow(
			RangeError,
		);
	});

	it('throws RangeError for an interval value beyond Number.isSafeInteger', () => {
		const options = createOptions();
		expect(() => applyCrawlRuntimeOptionsPatch(options, { interval: 2 ** 53 })).toThrow(
			RangeError,
		);
	});

	it('throws RangeError for a negative interval', () => {
		const options = createOptions();
		expect(() => applyCrawlRuntimeOptionsPatch(options, { interval: -1 })).toThrow(
			RangeError,
		);
	});

	it('throws TypeError for an empty-string exclude entry', () => {
		const options = createOptions();
		expect(() => applyCrawlRuntimeOptionsPatch(options, { excludes: [''] })).toThrow(
			TypeError,
		);
	});

	it('validates all fields before applying any of them (atomic on failure)', () => {
		const options = createOptions();
		expect(() =>
			applyCrawlRuntimeOptionsPatch(options, { parallels: 4, interval: -1 }),
		).toThrow(RangeError);
		// parallels 側は正当な値でも、interval が不正なら全体が拒否され parallels も更新されない
		expect(options.parallels).toBe(1);
	});

	it('replaces options.excludeUrls with a fresh array even when the patch omits it, matching excludes/excludeKeywords', () => {
		// `excludes`/`excludeKeywords` always get a fresh array (the
		// `[...mergeUnique(...)]` spread runs unconditionally); `excludeUrls`
		// once skipped that outer spread, so a call that added nothing to it
		// left `options.excludeUrls` pointing at the exact same array object
		// it held before the call — unlike its two siblings, whose returned
		// snapshot a caller could safely treat as a disposable copy.
		const options = createOptions();
		const before = options.excludeUrls;

		applyCrawlRuntimeOptionsPatch(options, { parallels: 4 });

		expect(options.excludeUrls).not.toBe(before);
		expect(options.excludeUrls).toEqual(before);
	});

	it('is a no-op returning the current snapshot when the patch is empty', () => {
		const options = createOptions();
		const snapshot = applyCrawlRuntimeOptionsPatch(options, {});
		expect(snapshot).toEqual({
			parallels: 1,
			interval: 0,
			excludes: ['/existing/**'],
			excludeUrls: ['https://existing.example/'],
			excludeKeywords: ['existing-keyword'],
			addedExcludes: [],
			addedExcludeUrls: [],
			addedExcludeKeywords: [],
		});
	});

	describe('addedExcludes/addedExcludeUrls/addedExcludeKeywords', () => {
		it('reports an already-present exclude entry as not added', () => {
			const options = createOptions();
			const snapshot = applyCrawlRuntimeOptionsPatch(options, {
				excludes: ['/existing/**'],
			});
			expect(snapshot.addedExcludes).toEqual([]);
		});

		it('reports only the genuinely new entries when a patch mixes new and already-present ones', () => {
			const options = createOptions();
			const snapshot = applyCrawlRuntimeOptionsPatch(options, {
				excludes: ['/existing/**', '/new/**'],
			});
			expect(snapshot.addedExcludes).toEqual(['/new/**']);
		});

		it('counts a duplicate within the same patch only once', () => {
			const options = createOptions();
			const snapshot = applyCrawlRuntimeOptionsPatch(options, {
				excludeUrls: ['https://new.example/', 'https://new.example/'],
			});
			expect(snapshot.addedExcludeUrls).toEqual(['https://new.example/']);
		});

		it('is empty for a field the patch does not touch', () => {
			const options = createOptions();
			const snapshot = applyCrawlRuntimeOptionsPatch(options, { parallels: 4 });
			expect(snapshot.addedExcludes).toEqual([]);
			expect(snapshot.addedExcludeUrls).toEqual([]);
			expect(snapshot.addedExcludeKeywords).toEqual([]);
		});
	});
});
