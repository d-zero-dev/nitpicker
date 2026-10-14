import type { TemplateClassificationProgress } from './types.js';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import Archive from '../archive.js';

import { collectPageIdsWithHtml } from './collect-page-ids-with-html.js';
import { createContentRootHint } from './create-content-root-hint.js';
import { loadPageClusterCandidates } from './load-page-cluster-candidates.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_load_page_cluster_candidates__',
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

describe('loadPageClusterCandidates', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'load-page-cluster-candidates.nitpicker',
	);

	/**
	 * Adds one page, optionally with a detected main-content element.
	 * @param url
	 * @param options
	 * @param options.contentType
	 * @param options.isExternal
	 * @param options.main
	 */
	async function addPage(
		url: string,
		options: {
			contentType?: string;
			isExternal?: boolean;
			main?: {
				nodeName: string;
				id: string | null;
				classList: string[];
				role: string | null;
			} | null;
		} = {},
	) {
		const { contentType = 'text/html', isExternal = false, main = null } = options;
		await archive.setPage({
			url: parseUrl(url)!,
			redirectPaths: [],
			isExternal,
			isTarget: !isExternal,
			status: 200,
			statusText: 'OK',
			contentType,
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

		await addPage('https://example.com/news/1', {
			main: { nodeName: 'DIV', id: 'main', classList: ['spc'], role: null },
		});
		await addPage('https://example.com/list?page=2');
		await addPage('http://example.com:8080/with-port');
		await addPage('https://external.example/other', { isExternal: true });
		await addPage('https://example.com/file.pdf', { contentType: 'application/pdf' });
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('内部HTMLページだけを返す（外部ページ・非HTMLページは含まない）', async () => {
		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: await collectPageIdsWithHtml(archive),
		});

		expect(candidates.map((candidate) => candidate.href)).toEqual([
			'https://example.com/news/1',
			'https://example.com/list?page=2',
			'http://example.com:8080/with-port',
		]);
	});

	it('id・href・paths・host がPageベースの読み出しと一致する（ポート付きはhost:port）', async () => {
		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: await collectPageIdsWithHtml(archive),
		});
		const pages = await archive.getPages('internal-page');

		expect(candidates.map((candidate) => candidate.id)).toEqual(
			pages.map((page) => page.id),
		);
		for (const [index, page] of pages.entries()) {
			const { url } = page;
			expect(candidates[index]!.href).toBe(url.href);
			expect(candidates[index]!.paths).toEqual(url.paths);
		}
		expect(candidates.map((candidate) => candidate.host)).toEqual([
			'example.com',
			'example.com',
			'example.com:8080',
		]);
	});

	it('本文要素のヒントがPageベースの createContentRootHint と一致し、未検出ページにはキー自体を付けない', async () => {
		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: await collectPageIdsWithHtml(archive),
		});
		const pages = await archive.getPages('internal-page');

		expect(candidates[0]!.contentRoot).toStrictEqual({
			tagName: 'div',
			id: 'main',
			classList: ['spc'],
		});
		expect(candidates[0]!.contentRoot).toStrictEqual(createContentRootHint(pages[0]));
		expect(candidates[1]).not.toHaveProperty('contentRoot');
	});

	it('バッチごとに loading-pages の進捗（done と total）を通知する', async () => {
		const events: TemplateClassificationProgress[] = [];

		await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: await collectPageIdsWithHtml(archive),
			onProgress: (event) => {
				events.push(event);
			},
		});

		expect(events).toEqual([{ phase: 'loading-pages', done: 3, total: 3 }]);
	});

	it('pageIdsWithHtml に無いページは候補にしない（HTML 無しのページは保持されない）', async () => {
		const pages = await archive.getPages('internal-page');
		const [first, , third] = pages;

		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: new Set([first!.id, third!.id]),
		});

		expect(candidates.map((candidate) => candidate.id)).toEqual([first!.id, third!.id]);
	});

	it('複数バッチに分けて読んでも、同じ候補を同じ順序で返し、バッチごとに累計の進捗を通知する', async () => {
		const pageIdsWithHtml = await collectPageIdsWithHtml(archive);
		const whole = await loadPageClusterCandidates(archive, { pageIdsWithHtml });
		const events: TemplateClassificationProgress[] = [];

		const batched = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml,
			batchSize: 2,
			onProgress: (event) => {
				events.push(event);
			},
		});

		expect(batched).toEqual(whole);
		expect(events).toEqual([
			{ phase: 'loading-pages', done: 2, total: 3 },
			{ phase: 'loading-pages', done: 3, total: 3 },
		]);
	});

	it('HTML 無しのページだけのバッチを挟んでも、後続のバッチのページを取りこぼさない', async () => {
		const pages = await archive.getPages('internal-page');
		const last = pages.at(-1)!;

		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: new Set([last.id]),
			batchSize: 1,
		});

		expect(candidates.map((candidate) => candidate.id)).toEqual([last.id]);
	});

	it('保存された URL が解釈できなければ、その URL を示すエラーにする', async () => {
		const [first] = await archive.getPages('internal-page');
		const knex = archive.getKnex();
		const urlRef = (await knex('content_items')
			.where('id', first!.id)
			.first('url_id')) as { url_id: number };
		await knex('url_refs').where('id', urlRef.url_id).update({ url: 'not a url' });

		try {
			await expect(
				loadPageClusterCandidates(archive, {
					pageIdsWithHtml: await collectPageIdsWithHtml(archive),
				}),
			).rejects.toThrow(
				'loadPageClusterCandidates: cannot parse the stored URL not a url',
			);
		} finally {
			await knex('url_refs').where('id', urlRef.url_id).update({ url: first!.url.href });
		}
	});

	it('保存された main_content_class_list が壊れていれば、黙って捨てずにエラーにする', async () => {
		const [first] = await archive.getPages('internal-page');
		const knex = archive.getKnex();
		await knex('page_meta').where('page_id', first!.id).update({
			main_content_class_list: '{oops',
		});

		try {
			await expect(
				loadPageClusterCandidates(archive, {
					pageIdsWithHtml: await collectPageIdsWithHtml(archive),
				}),
			).rejects.toThrow('main_content_class_list is not valid JSON: {oops');
		} finally {
			await knex('page_meta').where('page_id', first!.id).update({
				main_content_class_list: '["spc"]',
			});
		}
	});

	it('pageIdsWithHtml が空なら候補は空になる', async () => {
		const candidates = await loadPageClusterCandidates(archive, {
			pageIdsWithHtml: new Set(),
		});

		expect(candidates).toEqual([]);
	});

	it('内部HTMLページが無いアーカイブでは空配列を返し、進捗も通知しない', async () => {
		const emptyDir = path.resolve(workingDir, 'empty');
		const { mkdirSync } = await import('node:fs');
		mkdirSync(emptyDir, { recursive: true });
		const emptyArchive = await Archive.create({
			filePath: path.resolve(emptyDir, 'empty.nitpicker'),
			cwd: emptyDir,
		});
		const events: TemplateClassificationProgress[] = [];

		try {
			const candidates = await loadPageClusterCandidates(emptyArchive, {
				pageIdsWithHtml: new Set(),
				onProgress: (event) => {
					events.push(event);
				},
			});

			expect(candidates).toEqual([]);
			expect(events).toEqual([]);
		} finally {
			await emptyArchive.close();
		}
	});
});
