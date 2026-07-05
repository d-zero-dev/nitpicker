/* eslint-disable @typescript-eslint/require-await -- onRow callbacks are async to match externalSortUrls' signature but only push into a synchronous results array. */
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { pathComparator } from '@d-zero/shared/sort/path';
import { Archive } from '@nitpicker/crawler';
import { afterEach, describe, expect, it } from 'vitest';

import { externalSortUrls } from './external-url-sort.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_external_url_sort__');

const META = {
	lang: null,
	title: null,
	description: null,
	keywords: null,
	noindex: false,
	nofollow: false,
	noarchive: false,
	canonical: null,
	alternate: null,
	'og:type': null,
	'og:title': null,
	'og:site_name': null,
	'og:description': null,
	'og:url': null,
	'og:image': null,
	'twitter:card': null,
};

/**
 * Minimal config so {@link Archive.create} has a valid `info` row.
 * @returns A config object accepted by `Archive.setConfig`.
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
 * Adds a minimal internal HTML page to the archive.
 * @param archive - The archive to write to.
 * @param url - The page URL.
 */
async function addPage(archive: InstanceType<typeof Archive>, url: string) {
	await archive.setPage({
		url: parseUrl(url)!,
		redirectPaths: [],
		isExternal: false,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 100,
		responseHeaders: {},
		html: '',
		meta: META,
		anchorList: [],
		imageList: [],
		isSkipped: false,
	});
}

describe('externalSortUrls', () => {
	let archive: InstanceType<typeof Archive> | undefined;

	afterEach(async () => {
		if (archive) {
			await archive.close();
			archive = undefined;
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('ranks pages+resources URLs in natural order even when forced across many small chunks', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'sort.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		const pageUrls = [
			'https://example.com/image-10.jpg',
			'https://example.com/image-2.jpg',
			'https://example.com/about/',
		];
		for (const url of pageUrls) {
			await addPage(archive, url);
		}
		await archive.setResources({
			url: parseUrl('https://example.com/style.css')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/css',
			contentLength: 100,
			compress: false,
			cdn: false,
			headers: null,
		});

		const results: { url: string; rank: number }[] = [];
		// chunkSize=1 forces every single row into its own chunk file,
		// exercising the split + K-way merge path with 4 chunk files.
		await externalSortUrls(
			archive,
			async (url, rank) => {
				results.push({ url, rank });
			},
			{ readChunkSize: 1 },
		);

		const expectedOrder = [...pageUrls, 'https://example.com/style.css'].toSorted(
			pathComparator,
		);
		expect(results.map((r) => r.url)).toEqual(expectedOrder);
		// Ranks are 0-based and strictly increasing.
		expect(results.map((r) => r.rank)).toEqual(expectedOrder.map((_, index) => index));
	});

	it('emits each distinct URL exactly once when the same URL exists in both pages and resources', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'dedup.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		// pages.url and resources.url both have a UNIQUE constraint per table,
		// but the same literal URL can appear in both tables (e.g. a page that
		// is also linked as a sub-resource target elsewhere).
		await addPage(archive, 'https://example.com/shared');
		await archive.setResources({
			url: parseUrl('https://example.com/shared')!,
			isExternal: false,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			compress: false,
			cdn: false,
			headers: null,
		});

		const results: { url: string; rank: number }[] = [];
		await externalSortUrls(
			archive,
			async (url, rank) => {
				results.push({ url, rank });
			},
			{ readChunkSize: 1 },
		);

		expect(results).toEqual([{ url: 'https://example.com/shared', rank: 0 }]);
	});

	it('produces no output and leaves no temp directory for an archive with no pages or resources', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'empty.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());

		const results: { url: string; rank: number }[] = [];
		await externalSortUrls(archive, async (url, rank) => {
			results.push({ url, rank });
		});

		expect(results).toEqual([]);
		// The scratch dir is `mkdtemp`'d (a random `url-sort-tmp-XXXXXX`
		// suffix, not a fixed name) so concurrent callers on the same
		// accessor never collide — assert no such directory survives instead
		// of checking one exact name.
		const { readdirSync } = await import('node:fs');
		expect(
			readdirSync(archive.tmpDir).some((name) => name.startsWith('url-sort-tmp-')),
		).toBe(false);
	});

	it('cleans up the temp directory even when onRow throws', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'cleanup-on-error.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		await addPage(archive, 'https://example.com/');

		await expect(
			externalSortUrls(archive, () => {
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');

		// The scratch dir is `mkdtemp`'d (a random `url-sort-tmp-XXXXXX`
		// suffix, not a fixed name) so concurrent callers on the same
		// accessor never collide — assert no such directory survives instead
		// of checking one exact name.
		const { readdirSync } = await import('node:fs');
		expect(
			readdirSync(archive.tmpDir).some((name) => name.startsWith('url-sort-tmp-')),
		).toBe(false);
	});
});
