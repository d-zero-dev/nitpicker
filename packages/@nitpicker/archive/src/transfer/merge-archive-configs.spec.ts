import type { Config } from '../types.js';

import { describe, it, expect } from 'vitest';

import { mergeArchiveConfigs } from './merge-archive-configs.js';
import { ArchiveConfigConflictError } from './types.js';

/**
 * Builds a minimal valid {@link Config} for a test, with overrides.
 * @param overrides - Fields to override.
 */
function makeConfig(overrides: Partial<Config> = {}): Config {
	return {
		version: '0.13.0',
		name: 'a',
		baseUrl: 'https://a.example.com/',
		roots: ['https://a.example.com/'],
		recursive: true,
		interval: 0,
		image: false,
		fetchExternal: false,
		parallels: 1,
		excludes: [],
		excludeKeywords: [],
		excludeUrls: [],
		maxExcludedDepth: 0,
		retry: 3,
		fromList: false,
		disableQueries: false,
		userAgent: 'test',
		ignoreRobots: false,
		mainContentSelector: null,
		...overrides,
	};
}

describe('mergeArchiveConfigs', () => {
	it('unions roots and exclude lists in argument order, deduplicated', () => {
		const merged = mergeArchiveConfigs(
			[
				makeConfig({ roots: ['https://a.example.com/'], excludes: ['/x/'] }),
				makeConfig({
					roots: ['https://b.example.com/', 'https://a.example.com/'],
					excludes: ['/x/', '/y/'],
				}),
			],
			'merged',
		);
		expect(merged.roots).toEqual(['https://a.example.com/', 'https://b.example.com/']);
		expect(merged.baseUrl).toBe('https://a.example.com/');
		expect(merged.excludes).toEqual(['/x/', '/y/']);
		expect(merged.name).toBe('merged');
	});

	it('unions requestHeaderNames across sources and tolerates sources without any', () => {
		const merged = mergeArchiveConfigs(
			[
				makeConfig({ requestHeaderNames: ['Authorization'] }),
				makeConfig({ requestHeaderNames: ['X-Api-Key', 'Authorization'] }),
				makeConfig(),
			],
			'merged',
		);
		expect(merged.requestHeaderNames).toEqual(['Authorization', 'X-Api-Key']);
	});

	it('yields an empty requestHeaderNames when no source recorded any', () => {
		const merged = mergeArchiveConfigs([makeConfig(), makeConfig()], 'merged');
		expect(merged.requestHeaderNames).toEqual([]);
	});

	it('takes scalar settings from the first source', () => {
		const merged = mergeArchiveConfigs(
			[makeConfig({ parallels: 2 }), makeConfig({ parallels: 8 })],
			'merged',
		);
		expect(merged.parallels).toBe(2);
	});

	it('throws when disableQueries differs across sources, naming the exact field and values', () => {
		try {
			mergeArchiveConfigs(
				[makeConfig({ disableQueries: false }), makeConfig({ disableQueries: true })],
				'merged',
			);
			expect.unreachable('mergeArchiveConfigs should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(ArchiveConfigConflictError);
			const conflict = error as ArchiveConfigConflictError;
			expect(conflict.field).toBe('disableQueries');
			expect(conflict.values).toEqual([false, true]);
		}
	});

	it('throws when fromList differs across sources, naming the exact field and values', () => {
		try {
			mergeArchiveConfigs(
				[makeConfig({ fromList: false }), makeConfig({ fromList: true })],
				'merged',
			);
			expect.unreachable('mergeArchiveConfigs should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(ArchiveConfigConflictError);
			const conflict = error as ArchiveConfigConflictError;
			expect(conflict.field).toBe('fromList');
			expect(conflict.values).toEqual([false, true]);
		}
	});

	it('always scrubs createdCwd and pins version to the required format version', () => {
		const merged = mergeArchiveConfigs(
			[makeConfig({ createdCwd: '/tmp/somewhere', version: '0.10.0' })],
			'merged',
		);
		expect(merged.createdCwd).toBeNull();
		expect(merged.version).toBe('0.13.0');
	});
});
