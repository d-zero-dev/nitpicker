import type { Config } from '../types.js';

import { describe, it, expect } from 'vitest';

import { buildSplitConfig } from './build-split-config.js';

const SOURCE_CONFIG: Config = {
	version: '0.13.0',
	name: 'site',
	baseUrl: 'https://example.com/',
	roots: ['https://example.com/'],
	recursive: true,
	interval: 100,
	image: true,
	fetchExternal: false,
	parallels: 4,
	excludes: ['/private/'],
	excludeKeywords: [],
	excludeUrls: [],
	maxExcludedDepth: 0,
	retry: 3,
	fromList: false,
	disableQueries: false,
	userAgent: 'test',
	ignoreRobots: false,
	mainContentSelector: null,
	createdCwd: '/some/dir',
};

describe('buildSplitConfig', () => {
	it('sets roots/baseUrl to the given scope and carries the rest over', () => {
		const config = buildSplitConfig(SOURCE_CONFIG, ['https://example.com/blog/'], 'blog');
		expect(config.roots).toEqual(['https://example.com/blog/']);
		expect(config.baseUrl).toBe('https://example.com/blog/');
		expect(config.name).toBe('blog');
		expect(config.interval).toBe(100);
		expect(config.excludes).toEqual(['/private/']);
		expect(config.createdCwd).toBeNull();
	});

	it('throws when given no scope URLs', () => {
		expect(() => buildSplitConfig(SOURCE_CONFIG, [], 'blog')).toThrow();
	});
});
