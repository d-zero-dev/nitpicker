import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildViewerReadModel } from '../viewer-read-model/build-viewer-read-model.js';

import { countPageListHostnames } from './count-page-list-hostnames.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_count_page_list_hostnames__');

const BASE_CONFIG = {
	baseUrl: 'https://example.com',
	name: 'test',
	version: '0.13.0',
	recursive: true,
	interval: 0,
	image: true,
	fetchExternal: false,
	parallels: 1,
	roots: ['https://example.com', 'https://other.example'],
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

describe('countPageListHostnames', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'count-page-list-hostnames-test.nitpicker',
	);

	/**
	 * Stores one page in the fixture archive.
	 * @param url - The page's absolute URL.
	 * @param overrides - Fields to change from the internal-HTML default.
	 * @param overrides.isExternal
	 */
	async function setPage(
		url: string,
		overrides: { isExternal?: boolean } = {},
	): Promise<void> {
		await archive.setPage({
			url: parseUrl(url)!,
			redirectPaths: [],
			isExternal: overrides.isExternal ?? false,
			isTarget: !overrides.isExternal,
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

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);

		await setPage('https://example.com/news/a');
		await setPage('https://example.com/blog/post-1');
		await setPage('https://other.example/blog/post-2');
		await setPage('https://external.example/blog/post-3', { isExternal: true });

		await buildViewerReadModel(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('counts every internal host, ignoring external ones', async () => {
		expect(await countPageListHostnames(archive)).toBe(2);
	});

	it('counts only the hosts that have a page under the filtered prefix', async () => {
		expect(await countPageListHostnames(archive, { directories: ['/news'] })).toBe(1);
		expect(await countPageListHostnames(archive, { directories: ['/blog'] })).toBe(2);
	});

	it('counts the host a full-URL filter names', async () => {
		const hosts = await countPageListHostnames(archive, {
			directories: ['https://other.example/blog'],
		});
		expect(hosts).toBe(1);
	});

	it('counts 0 when the filter matches no page', async () => {
		expect(await countPageListHostnames(archive, { directories: ['/shop'] })).toBe(0);
	});
});
