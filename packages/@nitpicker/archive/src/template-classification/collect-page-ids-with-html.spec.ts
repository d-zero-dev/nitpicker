import { createHash } from 'node:crypto';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import Archive from '../archive.js';

import { collectPageIdsWithHtml } from './collect-page-ids-with-html.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_collect_page_ids_with_html__',
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

describe('collectPageIdsWithHtml', () => {
	let archive: InstanceType<typeof Archive>;

	/**
	 * Adds one page with the given stored HTML.
	 * @param url
	 * @param html
	 */
	async function addPage(url: string, html: string) {
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
			html,
			meta: baseMeta,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	}

	/**
	 * The page stored under `url`.
	 * @param url
	 */
	async function pageAt(url: string) {
		const pages = await archive.getPages();
		return pages.find((page) => page.url.href === url)!;
	}

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'collect-page-ids-with-html-test.nitpicker'),
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

		await addPage('https://example.com/with-html', '<html><body>a</body></html>');
		await addPage('https://example.com/no-html', '');
		await addPage('https://example.com/empty-blob', '');

		// An empty snapshot is never written by a crawl, but a stored one must
		// read as "no HTML", as `Page.getHtml()` returning `''` does.
		const emptyHash = createHash('sha256').update(Buffer.alloc(0)).digest();
		const knex = archive.getKnex();
		await knex('page_html_blobs').insert({
			hash: emptyHash,
			body: Buffer.alloc(0),
			codec: 'none',
			size_raw: 0,
			size_stored: 0,
		});
		const emptyPage = await pageAt('https://example.com/empty-blob');
		await knex('page_html_ref').insert({ page_id: emptyPage.id, hash: emptyHash });
		expect(await emptyPage.getHtml()).toBe('');
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('空でない HTML が保存されたページの id だけを返す', async () => {
		const withHtml = await pageAt('https://example.com/with-html');
		expect([...(await collectPageIdsWithHtml(archive))]).toEqual([withHtml.id]);
	});

	it('返す id の集合は Page.getHtml() が真値を返すページと一致する', async () => {
		const ids = await collectPageIdsWithHtml(archive);
		for (const page of await archive.getPages()) {
			expect(ids.has(page.id)).toBe(Boolean(await page.getHtml()));
		}
	});
});
