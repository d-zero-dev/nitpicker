import type { TemplateClassificationProgress } from './types.js';

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import Archive from '../archive.js';

import { classifyArchivePageTemplates } from './classify-archive-page-templates.js';

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_classify_archive_page_templates__',
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

const ARTICLE_A = `<html><body><header class="site-header"></header><main><article><h1>A</h1><p>Body text A</p></article></main><footer class="site-footer"></footer></body></html>`;
const ARTICLE_B = `<html><body><header class="site-header"></header><main><article><h1>B</h1><p>Body text B, quite different wording</p></article></main><footer class="site-footer"></footer></body></html>`;
const LIST_C = `<html><body><nav class="site-nav"></nav><section><ul><li>one</li><li>two</li><li>three</li></ul></section></body></html>`;

describe('classifyArchivePageTemplates', () => {
	let archive: InstanceType<typeof Archive>;

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'classify-archive.nitpicker'),
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
		for (const [p, html] of [
			['/article-1', ARTICLE_A],
			['/article-2', ARTICLE_B],
			['/list', LIST_C],
		] as const) {
			await archive.setPage({
				url: parseUrl(`https://example.com${p}`)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: html.length,
				responseHeaders: {},
				html,
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
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('全ページを分類してpage_templates / page_template_clusters / page_template_labelsに書き込む', async () => {
		const result = await classifyArchivePageTemplates(archive);

		expect(result).toEqual({ classifiedPageCount: 3, templateCount: 2 });
		const knex = archive.getKnex();
		expect(await knex('page_templates').count({ n: '*' }).first()).toEqual({ n: 3 });
		expect(await knex('page_template_clusters').count({ n: '*' }).first()).toEqual({
			n: 2,
		});
		expect(await knex('page_template_labels').count({ n: '*' }).first()).toEqual({
			n: 2,
		});
	});

	it('ページ読み込みの進捗を件数付きで通知し、クラスタリングの進捗が続く', async () => {
		const events: TemplateClassificationProgress[] = [];

		await classifyArchivePageTemplates(archive, {
			onProgress: (event) => {
				events.push(event);
			},
		});

		expect(events[0]).toEqual({ phase: 'loading-pages-start' });
		expect(events[1]).toEqual({ phase: 'loading-pages', done: 3, total: 3 });
		expect(events[2]).toEqual({ phase: 'collecting-stylesheets' });
		expect(events.at(-1)).toEqual({ phase: 'writing-results', templateCount: 2 });
		// Clustering events sit between the stylesheet step and the write.
		expect(events.slice(3, -1).length).toBeGreaterThan(0);
	});

	it('再実行しても同じテンプレートには同じラベルが付き続ける', async () => {
		const knex = archive.getKnex();
		await classifyArchivePageTemplates(archive);
		const before = await knex('page_template_labels')
			.select('template_key', 'section', 'ordinal')
			.orderBy('template_key');

		await classifyArchivePageTemplates(archive);
		const after = await knex('page_template_labels')
			.select('template_key', 'section', 'ordinal')
			.orderBy('template_key');

		expect(after).toEqual(before);
	});

	it('分類できるページが1件も無い場合は、既存の分類を空で上書きしない', async () => {
		const emptyDir = path.resolve(workingDir, 'no-html');
		mkdirSync(emptyDir, { recursive: true });
		const emptyArchive = await Archive.create({
			filePath: path.resolve(emptyDir, 'no-html.nitpicker'),
			cwd: emptyDir,
		});
		try {
			await emptyArchive.setConfig({
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
			await emptyArchive.setPage({
				url: parseUrl('https://example.com/no-html')!,
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
			await emptyArchive.replacePageTemplates(
				new Map([['https://example.com/no-html', 'previous-key']]),
			);

			const result = await classifyArchivePageTemplates(emptyArchive);

			expect(result).toEqual({ classifiedPageCount: 0, templateCount: 0 });
			const rows = await emptyArchive
				.getKnex()('page_templates')
				.select('template_key as templateKey');
			expect(rows).toEqual([{ templateKey: 'previous-key' }]);
		} finally {
			await emptyArchive.close();
		}
	});
});
