import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterEach, describe, expect, it } from 'vitest';

import { readCrawlErrors } from './read-crawl-errors.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_read_crawl_errors__');

/**
 * @returns A minimal Config the archive accepts.
 */
function baseConfig() {
	return {
		baseUrl: 'https://example.com',
		name: 'test',
		version: '0.13.0',
		recursive: true,
		interval: 0,
		image: false,
		fetchExternal: true,
		parallels: 1,
		roots: ['https://example.com'],
		excludes: [],
		excludeKeywords: [],
		excludeUrls: [],
		maxExcludedDepth: 0,
		retry: 3,
		fromList: false,
		disableQueries: false,
		userAgent: 'test',
		ignoreRobots: false,
	};
}

describe('readCrawlErrors', () => {
	afterEach(async () => {
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty array when the crawl_errors table has no rows', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
			filePath: path.resolve(workingDir, 'capture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		const records = await readCrawlErrors(archive);
		expect(records).toEqual([]);
	});

	it('returns one ErrorRecord per crawl_errors row, preserving null url for process-level entries', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		await using archive = await Archive.create({
			filePath: path.resolve(workingDir, 'capture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		await archive.addError({
			pid: 1,
			isMainProcess: true,
			url: 'https://example.com/dead',
			isExternal: false,
			error: new Error('getaddrinfo ENOTFOUND example.com'),
		});
		await archive.addError({
			pid: 1,
			isMainProcess: true,
			url: null,
			isExternal: false,
			error: new Error('process-level boom'),
		});

		const records = await readCrawlErrors(archive);
		expect(records).toHaveLength(2);
		const dnsRecord = records.find((r) => r.url === 'https://example.com/dead');
		expect(dnsRecord?.message).toBe('getaddrinfo ENOTFOUND example.com');
		const processRecord = records.find((r) => r.url === null);
		expect(processRecord?.message).toBe('process-level boom');
	});
});
