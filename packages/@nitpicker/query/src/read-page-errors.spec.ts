import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterEach, describe, expect, it } from 'vitest';

import { readPageErrors } from './read-page-errors.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_read_page_errors__');

/**
 * @returns A minimal Config the archive accepts.
 */
function baseConfig() {
	return {
		baseUrl: 'https://example.com',
		name: 'test',
		version: '0.10.0',
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

describe('readPageErrors', () => {
	let archive: InstanceType<typeof Archive> | undefined;

	afterEach(async () => {
		if (archive) {
			await archive.close();
			archive = undefined;
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty array when the page_errors table has no rows', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'capture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		const records = await readPageErrors(archive);
		expect(records).toEqual([]);
	});

	it('joins each page_errors row to its pages.url and returns one ErrorRecord per row', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'capture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		await archive.setPage({
			url: parseUrl('https://example.com/page-a')!,
			redirectPaths: [],
			isExternal: false,
			status: -1,
			statusText: 'failed',
			contentLength: null,
			contentType: null,
			responseHeaders: {},
			meta: { title: 'failed' },
			anchorList: [],
			imageList: [],
			html: '',
			isSkipped: false,
		});
		await archive.addPageError(
			'https://example.com/page-a',
			'retryExhausted',
			'Navigation timeout of 60000 ms',
		);

		const records = await readPageErrors(archive);
		expect(records).toHaveLength(1);
		expect(records[0]!.url).toBe('https://example.com/page-a');
		expect(records[0]!.message).toBe('Navigation timeout of 60000 ms');
	});
});
