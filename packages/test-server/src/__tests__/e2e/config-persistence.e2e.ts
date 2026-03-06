import type { Config } from '@nitpicker/crawler';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Config persistence', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl(['http://localhost:8010/'], {
			userAgent: 'NitpickerE2EBot/1.0',
			ignoreRobots: true,
		});
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('userAgent がアーカイブに保存される', async () => {
		const config = await result.accessor.getConfig();
		expect(config.userAgent).toBe('NitpickerE2EBot/1.0');
	});

	it('ignoreRobots がアーカイブに保存される', async () => {
		const config = await result.accessor.getConfig();
		expect(config.ignoreRobots).toBe(1);
	});

	it('配列型フィールドがデシリアライズされる', async () => {
		const config = await result.accessor.getConfig();
		expect(Array.isArray(config.scope)).toBe(true);
		expect(Array.isArray(config.excludes)).toBe(true);
		expect(Array.isArray(config.excludeKeywords)).toBe(true);
		expect(Array.isArray(config.excludeUrls)).toBe(true);
	});

	it('Config の全フィールドが存在する', async () => {
		const config = await result.accessor.getConfig();

		const expectedKeys: (keyof Config)[] = [
			'version',
			'name',
			'baseUrl',
			'recursive',
			'interval',
			'image',
			'fetchExternal',
			'parallels',
			'scope',
			'excludes',
			'excludeKeywords',
			'excludeUrls',
			'maxExcludedDepth',
			'retry',
			'fromList',
			'disableQueries',
			'userAgent',
			'ignoreRobots',
		];

		for (const key of expectedKeys) {
			expect(config).toHaveProperty(key);
		}
	});
});
