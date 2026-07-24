import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPageClusterFactory } from './create-page-cluster-factory.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_create_page_cluster_factory__',
);

const baseMeta = {
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
} as const;

describe('createPageClusterFactory', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'create-page-cluster-factory-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });

		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
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
		});

		// Internal HTML page — should be yielded.
		await archive.setPage({
			url: parseUrl('https://example.com/news/1')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html><body><article>one</article></body></html>',
			meta: baseMeta,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// External page — excluded by isInternalPage().
		await archive.setPage({
			url: parseUrl('https://external.example/other')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: baseMeta,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Internal but non-HTML content — excluded by isInternalPage() (isPage() false).
		await archive.setPage({
			url: parseUrl('https://example.com/file.pdf')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'application/pdf',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: baseMeta,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('内部HTMLページのみyieldされる（外部ページ・非HTMLページは除外）、getYieldedUrlsは完走後に反映される', async () => {
		const pages = await archive.getPages();
		const { factory, getYieldedUrls } = createPageClusterFactory(pages, new Map());

		expect(getYieldedUrls()).toEqual([]);

		const signals = [];
		for await (const signal of factory()) {
			signals.push(signal);
		}

		expect(signals).toHaveLength(1);
		expect(getYieldedUrls()).toEqual(['https://example.com/news/1']);
	});

	it('factory()を複数回呼んでも同一順序・同一件数のページを返す', async () => {
		const pages = await archive.getPages();
		const { factory } = createPageClusterFactory(pages, new Map());

		const firstPass: string[] = [];
		for await (const signal of factory()) {
			firstPass.push(signal.html);
		}
		const secondPass: string[] = [];
		for await (const signal of factory()) {
			secondPass.push(signal.html);
		}

		expect(secondPass).toEqual(firstPass);
		expect(firstPass).toHaveLength(1);
	});

	it('paths/host/stylesheetHrefsを正しくマッピングする', async () => {
		const pages = await archive.getPages();
		const stylesheetsByUrl = new Map<string, readonly string[]>([
			['https://example.com/news/1', ['https://example.com/style.css']],
		]);
		const { factory } = createPageClusterFactory(pages, stylesheetsByUrl);

		const signals = [];
		for await (const signal of factory()) {
			signals.push(signal);
		}

		expect(signals).toHaveLength(1);
		expect(signals[0]!.paths).toEqual(['news', '1']);
		expect(signals[0]!.host).toBe('example.com');
		expect(signals[0]!.stylesheetHrefs).toEqual(['https://example.com/style.css']);
	});

	it('stylesheetsByUrlに存在しないページは空配列になる', async () => {
		const pages = await archive.getPages();
		const { factory } = createPageClusterFactory(pages, new Map());

		const signals = [];
		for await (const signal of factory()) {
			signals.push(signal);
		}

		expect(signals[0]!.stylesheetHrefs).toEqual([]);
	});
});

describe('createPageClusterFactory — 途中で打ち切ったイテレーションはgetYieldedUrlsを汚染しない', () => {
	let archive: InstanceType<typeof Archive>;
	const workingDir2 = path.resolve(
		__dirname,
		'__test_fixtures_create_page_cluster_factory_partial_drain__',
	);
	const archiveFilePath = path.resolve(workingDir2, 'partial-drain-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir2, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir2 });

		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
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
		});

		for (const p of ['/a', '/b']) {
			await archive.setPage({
				url: parseUrl(`https://example.com${p}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: baseMeta,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir2, { recursive: true, force: true });
	});

	it('前回の完走結果を保持したまま、未完走のイテレーションはgetYieldedUrlsを上書きしない', async () => {
		const pages = await archive.getPages();
		const { factory, getYieldedUrls } = createPageClusterFactory(pages, new Map());

		// First iteration: drain fully.
		const firstPass = [];
		for await (const signal of factory()) {
			firstPass.push(signal);
		}
		expect(firstPass).toHaveLength(2);
		expect(getYieldedUrls()).toEqual(['https://example.com/a', 'https://example.com/b']);

		// Second iteration: stop after the first item, never reaching the end
		// of the generator body (never calling `onDrained`).
		const secondPass = [];
		for await (const signal of factory()) {
			secondPass.push(signal);
			break;
		}
		expect(secondPass).toHaveLength(1);
		expect(getYieldedUrls()).toEqual(['https://example.com/a', 'https://example.com/b']);
	});
});
