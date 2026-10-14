import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import Archive from '../archive.js';

import { collectPageIdsWithHtml } from './collect-page-ids-with-html.js';
import { createPageClusterFactory } from './create-page-cluster-factory.js';
import { loadPageClusterCandidates } from './load-page-cluster-candidates.js';

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

		// Internal HTML page whose stored HTML is empty (no snapshot is
		// stored for it) — not in `collectPageIdsWithHtml`'s result.
		await archive.setPage({
			url: parseUrl('https://example.com/empty')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 0,
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

	it('内部HTMLページのみyieldされる（外部ページ・非HTMLページ・HTML無しページは除外）、urlsはイテレーション前から確定している', async () => {
		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: await collectPageIdsWithHtml(archive),
		});
		const { factory, urls } = createPageClusterFactory({
			archive,
			candidates,
			stylesheetsByUrl: new Map(),
		});

		expect(urls).toEqual(['https://example.com/news/1']);

		const signals = [];
		for await (const signal of factory()) {
			signals.push(signal);
		}

		expect(signals).toHaveLength(1);
		expect(urls).toEqual(['https://example.com/news/1']);
	});

	it('候補のcontentRootはそのまま載せ、無い候補にはキー自体を付けない', async () => {
		const { factory } = createPageClusterFactory({
			archive,
			candidates: [
				{
					id: 1,
					href: 'https://example.com/a',
					paths: ['a'],
					host: 'example.com',
					contentRoot: { tagName: 'div', id: 'main' },
				},
				{ id: 2, href: 'https://example.com/b', paths: ['b'], host: 'example.com' },
			],
			stylesheetsByUrl: new Map(),
		});

		const signals = [];
		for await (const signal of factory()) {
			signals.push(signal);
		}

		expect(signals[0]!.contentRoot).toStrictEqual({ tagName: 'div', id: 'main' });
		expect(signals[1]).not.toHaveProperty('contentRoot');
	});

	it('候補が空ならyieldされずurlsも空になる', async () => {
		const { factory, urls } = createPageClusterFactory({
			archive,
			candidates: [],
			stylesheetsByUrl: new Map(),
		});

		const signals = [];
		for await (const signal of factory()) {
			signals.push(signal);
		}

		expect(signals).toEqual([]);
		expect(urls).toEqual([]);
	});

	it('候補に挙がっているのに保存済みHTMLが無いページはgetHtmlが説明つきのエラーを投げる', async () => {
		const all = await archive.getPages('internal-page');
		const empty = all.find((page) => page.url.href === 'https://example.com/empty')!;
		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: new Set([empty.id]),
		});
		const { factory } = createPageClusterFactory({
			archive,
			candidates,
			stylesheetsByUrl: new Map(),
		});

		const signals = [];
		for await (const signal of factory()) {
			signals.push(signal);
		}

		expect(signals).toHaveLength(1);
		await expect(signals[0]!.getHtml()).rejects.toThrow(
			'createPageClusterFactory: https://example.com/empty has no stored HTML, but collectPageIdsWithHtml listed it',
		);
	});

	it('factory()を複数回呼んでも同一順序・同一件数のページを返す', async () => {
		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: await collectPageIdsWithHtml(archive),
		});
		const { factory } = createPageClusterFactory({
			archive,
			candidates,
			stylesheetsByUrl: new Map(),
		});

		const firstPass: string[] = [];
		for await (const signal of factory()) {
			firstPass.push(await signal.getHtml());
		}
		const secondPass: string[] = [];
		for await (const signal of factory()) {
			secondPass.push(await signal.getHtml());
		}

		expect(secondPass).toEqual(firstPass);
		expect(firstPass).toEqual(['<html><body><article>one</article></body></html>']);
	});

	it('paths/host/stylesheetHrefsを正しくマッピングする', async () => {
		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: await collectPageIdsWithHtml(archive),
		});
		const stylesheetsByUrl = new Map<string, readonly string[]>([
			['https://example.com/news/1', ['https://example.com/style.css']],
		]);
		const { factory } = createPageClusterFactory({
			archive,
			candidates,
			stylesheetsByUrl,
		});

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
		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: await collectPageIdsWithHtml(archive),
		});
		const { factory } = createPageClusterFactory({
			archive,
			candidates,
			stylesheetsByUrl: new Map(),
		});

		const signals = [];
		for await (const signal of factory()) {
			signals.push(signal);
		}

		expect(signals[0]!.stylesheetHrefs).toEqual([]);
	});
});

describe('createPageClusterFactory — urls は途中で打ち切ったイテレーションの影響を受けない', () => {
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

	it('urlsはyield順で、完走・途中打ち切りのどちらのイテレーションでも変わらない', async () => {
		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: await collectPageIdsWithHtml(archive),
		});
		const { factory, urls } = createPageClusterFactory({
			archive,
			candidates,
			stylesheetsByUrl: new Map(),
		});

		expect(urls).toEqual(['https://example.com/a', 'https://example.com/b']);

		// First iteration: drain fully.
		const firstPass = [];
		for await (const signal of factory()) {
			firstPass.push(signal);
		}
		expect(firstPass).toHaveLength(2);
		expect(urls).toEqual(['https://example.com/a', 'https://example.com/b']);

		// Second iteration: stop after the first item.
		const secondPass = [];
		for await (const signal of factory()) {
			secondPass.push(signal);
			break;
		}
		expect(secondPass).toHaveLength(1);
		expect(urls).toEqual(['https://example.com/a', 'https://example.com/b']);
	});
});

describe('createPageClusterFactory — 本文要素（contentRoot）のヒント', () => {
	let archive: InstanceType<typeof Archive>;
	const workingDir3 = path.resolve(
		__dirname,
		'__test_fixtures_create_page_cluster_factory_content_root__',
	);
	const archiveFilePath = path.resolve(workingDir3, 'content-root-test.nitpicker');

	/**
	 * Adds one internal HTML page, optionally with a detected main-content
	 * element (`main`), the way the crawler records it.
	 * @param pagePath
	 * @param main
	 */
	async function addPage(
		pagePath: string,
		main: {
			nodeName: string;
			id: string | null;
			classList: string[];
			role: string | null;
		} | null,
	) {
		await archive.setPage({
			url: parseUrl(`https://example.com${pagePath}`)!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html><body><div id="main"><p>x</p></div></body></html>',
			meta: baseMeta,
			anchorList: [],
			imageList: [],
			isSkipped: false,
			mainContents: {
				title: null,
				main: main && { ...main, selector: 'div#main' },
				wordCount: 0,
				bodyWordCount: 0,
				headings: [],
				images: [],
				tables: [],
				buttons: [],
				iframes: [],
				videos: [],
				audios: [],
				canvases: [],
			},
		} as never);
	}

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir3, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir3 });

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

		await addPage('/with-root', {
			nodeName: 'DIV',
			id: 'main',
			classList: ['spc'],
			role: null,
		});
		await addPage('/without-root', null);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir3, { recursive: true, force: true });
	});

	it('クローラが検出した本文要素を contentRoot として渡す（nodeName は小文字、classList はそのまま）', async () => {
		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: await collectPageIdsWithHtml(archive),
		});
		const { factory } = createPageClusterFactory({
			archive,
			candidates,
			stylesheetsByUrl: new Map(),
		});

		const signals = [];
		for await (const signal of factory()) {
			signals.push(signal);
		}

		const withRoot = signals.find((s) => s.paths[0] === 'with-root');
		expect(withRoot!.contentRoot).toStrictEqual({
			tagName: 'div',
			id: 'main',
			classList: ['spc'],
		});
	});

	it('本文要素が検出されていないページには contentRoot キー自体を付けない', async () => {
		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: await collectPageIdsWithHtml(archive),
		});
		const { factory } = createPageClusterFactory({
			archive,
			candidates,
			stylesheetsByUrl: new Map(),
		});

		const signals = [];
		for await (const signal of factory()) {
			signals.push(signal);
		}

		const withoutRoot = signals.find((s) => s.paths[0] === 'without-root');
		expect(withoutRoot).toBeDefined();
		expect(withoutRoot).not.toHaveProperty('contentRoot');
	});
});
