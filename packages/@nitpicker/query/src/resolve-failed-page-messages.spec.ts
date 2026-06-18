import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveFailedPageMessages } from './resolve-failed-page-messages.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_resolve_failed__');

/**
 * @returns A minimal `Config` that satisfies `Archive.setConfig`.
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

/**
 * Insert a status=-1 page row.
 * @param archive - The opened archive.
 * @param url - The page URL.
 * @returns The inserted page's id.
 */
function insertFailedPage(
	archive: InstanceType<typeof Archive>,
	url: string,
): Promise<number> {
	return archive.setPage({
		url: parseUrl(url)!,
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
}

describe('resolveFailedPageMessages', () => {
	let archive: InstanceType<typeof Archive> | undefined;

	afterEach(async () => {
		if (archive) {
			await archive.close();
			archive = undefined;
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns an empty map when no pageIds are passed', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'capture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		const messages = await resolveFailedPageMessages(archive, []);
		expect(messages.size).toBe(0);
	});

	it('prefers page_errors over crawl_errors when both are present for the same URL', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'capture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		const id = await insertFailedPage(archive, 'https://example.com/dual');
		await archive.addPageError(
			'https://example.com/dual',
			'retryExhausted',
			'Navigation timeout of 60000 ms',
		);
		await archive.addError({
			pid: 1,
			isMainProcess: true,
			url: 'https://example.com/dual',
			isExternal: false,
			error: new Error('getaddrinfo ENOTFOUND example.com'),
		});

		const messages = await resolveFailedPageMessages(archive, [id]);
		expect(messages.get(id)).toBe('Navigation timeout of 60000 ms');
	});

	it('falls back to crawl_errors when page_errors has no row for the page', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'capture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		const id = await insertFailedPage(archive, 'https://example.com/dns');
		await archive.addError({
			pid: 1,
			isMainProcess: true,
			url: 'https://example.com/dns',
			isExternal: false,
			error: new Error('getaddrinfo ENOTFOUND example.com'),
		});

		const messages = await resolveFailedPageMessages(archive, [id]);
		expect(messages.get(id)).toBe('getaddrinfo ENOTFOUND example.com');
	});

	it('returns a map without the pageId when no source records a message', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'capture.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		const id = await insertFailedPage(archive, 'https://example.com/orphan');

		const messages = await resolveFailedPageMessages(archive, [id]);
		expect(messages.has(id)).toBe(false);
	});
});
