import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listPages } from './list-pages.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_list_pages__');

describe('listPages', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'list-pages-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

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

		const pages = [
			{
				url: 'https://example.com/',
				status: 200,
				title: 'Home',
				description: 'Home page',
			},
			{
				url: 'https://example.com/about',
				status: 200,
				title: 'About',
				description: null,
			},
			{
				url: 'https://example.com/contact',
				status: 404,
				title: null,
				description: null,
			},
		];

		for (const p of pages) {
			await archive.setPage({
				url: parseUrl(p.url)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: p.status,
				statusText: p.status === 200 ? 'OK' : 'Not Found',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: `<html><head><title>${p.title ?? ''}</title></head></html>`,
				meta: {
					lang: 'ja',
					title: p.title,
					description: p.description,
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
				},
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		// An in-scope non-HTML resource (PDF): isTarget=1 but NOT a page. It must
		// not appear in the page list (page-ness is content-type, not isTarget).
		await archive.setPage({
			url: parseUrl('https://example.com/doc.pdf')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'application/pdf',
			contentLength: 1024,
			responseHeaders: {},
			html: '',
			meta: {
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('全ページをリストする', async () => {
		const result = await listPages(archive);
		expect(result.total).toBe(3);
		expect(result.items).toHaveLength(3);
	});

	it('非HTMLリソース（PDF, isTarget=1）はページ一覧に含まれない', async () => {
		const result = await listPages(archive);
		// PDF も scraped=1 / isTarget=1 で DB にあるが、content-type が text/html
		// でないのでページ一覧（SEO メタ一覧）には出さない。Resources ビュー側で見る。
		expect(result.items.some((p) => p.url.endsWith('/doc.pdf'))).toBe(false);
		expect(result.items.map((p) => p.contentType)).not.toContain('application/pdf');
	});

	it('ステータスコードでフィルタする', async () => {
		const result = await listPages(archive, { status: 404 });
		expect(result.total).toBe(1);
		expect(result.items[0]?.url).toBe('https://example.com/contact');
	});

	it('タイトル欠損ページをフィルタする', async () => {
		const result = await listPages(archive, { missingTitle: true });
		expect(result.total).toBe(1);
		expect(result.items[0]?.url).toBe('https://example.com/contact');
	});

	it('ページネーションが機能する', async () => {
		const result = await listPages(archive, { limit: 1, offset: 1 });
		expect(result.items).toHaveLength(1);
		expect(result.limit).toBe(1);
		expect(result.offset).toBe(1);
	});

	it('statusMin でフィルタする', async () => {
		const result = await listPages(archive, { statusMin: 400 });
		expect(result.total).toBe(1);
		expect(result.items[0]?.url).toBe('https://example.com/contact');
	});

	it('statusMax でフィルタする', async () => {
		const result = await listPages(archive, { statusMax: 200 });
		expect(result.total).toBe(2);
	});

	it('missingDescription でフィルタする', async () => {
		const result = await listPages(archive, { missingDescription: true });
		expect(result.total).toBe(2);
	});

	it('urlPattern でフィルタする', async () => {
		const result = await listPages(archive, { urlPattern: '%about%' });
		expect(result.total).toBe(1);
		expect(result.items[0]?.url).toBe('https://example.com/about');
	});

	it('sortBy と sortOrder が機能する', async () => {
		const result = await listPages(archive, { sortBy: 'status', sortOrder: 'desc' });
		expect(result.items[0]?.status).toBe(404);
		expect(result.items.at(-1)?.status).toBe(200);
	});

	it('directory でフィルタする', async () => {
		const result = await listPages(archive, { directory: 'example.com' });
		// Root URL (https://example.com) doesn't contain 'example.com/' so only subpages match
		expect(result.total).toBe(2);
	});

	it('contentTypeCategory="pdf" でフィルタすると PDF だけが返る', async () => {
		// 既定の HTML-or-null 制約を解除して PDF を表に出す。Pages ビューから
		// "300k 件の internal URL の大半が PDF" を直接ブラウズできるようにする
		// ためのフィルタ。
		const result = await listPages(archive, { contentTypeCategory: 'pdf' });
		expect(result.total).toBe(1);
		expect(result.items[0]?.url).toBe('https://example.com/doc.pdf');
		expect(result.items[0]?.contentType).toBe('application/pdf');
	});

	it('contentTypeCategory="html" でフィルタすると HTML だけが返る（null は含まない）', async () => {
		const result = await listPages(archive, { contentTypeCategory: 'html' });
		expect(result.total).toBe(3);
		expect(result.items.every((p) => p.contentType === 'text/html')).toBe(true);
	});
});

describe('listPages: セキュリティヘッダーの有無', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_list_pages_headers__');
	const archiveFilePath = path.resolve(dir, 'list-pages-headers-test.nitpicker');

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

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
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

		await archive.setPage({
			url: parseUrl('https://example.com/with-csp')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: { 'Content-Security-Policy': "default-src 'self'" },
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/no-headers')!,
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
		// `responseHeaders: null` is a real shape the crawler writes (e.g. the
		// JS-redirect-rescue path); it must not crash the SQL-computed
		// header-presence columns, which never JSON.parse the stored value.
		await archive.setPage({
			url: parseUrl('https://example.com/null-headers')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: null,
			html: '',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('does not throw when a page has responseHeaders: null', async () => {
		await expect(listPages(archive)).resolves.toBeDefined();
	});

	it('reports hasCSP per page and treats null responseHeaders as false', async () => {
		const result = await listPages(archive);
		const withCsp = result.items.find((p) => p.url.endsWith('/with-csp'));
		const noHeaders = result.items.find((p) => p.url.endsWith('/no-headers'));
		const nullHeaders = result.items.find((p) => p.url.endsWith('/null-headers'));
		expect(withCsp?.hasCSP).toBe(true);
		expect(noHeaders?.hasCSP).toBe(false);
		expect(nullHeaders?.hasCSP).toBe(false);
	});

	it('filters by hasCSP', async () => {
		const result = await listPages(archive, { hasCSP: true });
		expect(result.total).toBe(1);
		expect(result.items[0]?.url).toBe('https://example.com/with-csp');
	});
});

describe('listPages: ページ性は content-type（エラーページは残し、リソースだけ除外）', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(__dirname, '__test_fixtures_list_pages_errored__');
	const archiveFilePath = path.resolve(dir, 'list-pages-errored.nitpicker');

	/**
	 * Builds page data for this describe's fixtures.
	 * @param url - The page URL.
	 * @param status - HTTP status.
	 * @param contentType - The content type (null for an errored/unreachable page).
	 * @param html - The rendered HTML (empty for non-HTML / errored).
	 * @returns Page data accepted by `Archive.setPage`.
	 */
	const makePage = (
		url: string,
		status: number,
		contentType: string | null,
		html: string,
	) => ({
		url: parseUrl(url)!,
		redirectPaths: [] as string[],
		isExternal: false,
		isTarget: true,
		status,
		statusText: '',
		contentType,
		contentLength: 0,
		responseHeaders: {},
		html,
		meta: {
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
		},
		anchorList: [] as never[],
		imageList: [] as never[],
		isSkipped: false,
	});

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		await archive.setPage(
			makePage('https://example.com/', 200, 'text/html', '<html></html>'),
		);
		// In-scope PDF: a resource, excluded.
		await archive.setPage(
			makePage('https://example.com/doc.pdf', 200, 'application/pdf', ''),
		);
		// Errored / unreachable internal page: contentType null — must STAY listed.
		await archive.setPage(makePage('https://example.com/broken', -1, null, ''));
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('エラーページ（contentType null）は一覧に残り、リソース（PDF）だけ除外される', async () => {
		const result = await listPages(archive);
		const paths = result.items.map((p) => new URL(p.url).pathname).toSorted();
		expect(paths).toEqual(['/', '/broken']);
		expect(paths).not.toContain('/doc.pdf');
	});
});
