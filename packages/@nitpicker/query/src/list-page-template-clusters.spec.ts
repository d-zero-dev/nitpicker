import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listPageTemplateClusters } from './list-page-template-clusters.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

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

/**
 * Registers one internal, successfully-crawled HTML page with no CSS
 * references and no outbound links.
 * @param archive
 * @param urlString
 */
async function setTestPage(archive: InstanceType<typeof Archive>, urlString: string) {
	await archive.setPage({
		url: parseUrl(urlString)!,
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

/**
 * Creates a fresh writable fixture archive with base config, ready for
 * `setTestPage` calls.
 * @param workingDir
 * @param fileName
 */
async function createArchive(workingDir: string, fileName: string) {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, fileName),
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
	return archive;
}

/**
 * Closes a fixture archive and removes its scratch directory.
 * @param archive
 * @param workingDir
 */
async function destroyArchive(archive: InstanceType<typeof Archive>, workingDir: string) {
	await archive.close();
	const { rmSync } = await import('node:fs');
	rmSync(workingDir, { recursive: true, force: true });
}

describe('listPageTemplateClusters', () => {
	describe('--templatesが未実行のアーカイブ', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_template_clusters_unclassified__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			archive = await createArchive(workingDir, 'unclassified.nitpicker');
			await setTestPage(archive, 'https://example.com/a');
		});

		afterAll(async () => {
			await destroyArchive(archive, workingDir);
		});

		it('hasClassification: false と空のclustersを返す（テーブルは存在するが0行）', async () => {
			const result = await listPageTemplateClusters(archive);

			expect(result).toEqual({ hasClassification: false, clusters: [] });
		});
	});

	describe('page_templatesテーブル自体が存在しないアーカイブ（pre-`--templates`機能の古いアーカイブ）', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_template_clusters_no_table__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			archive = await createArchive(workingDir, 'no-table.nitpicker');
			await setTestPage(archive, 'https://example.com/a');
			// `createAdjunctTables` always provisions `page_templates` on a fresh
			// archive (see `list-page-template-clusters.ts`'s own JSDoc) — drop it
			// explicitly to exercise the `hasPageTemplatesTable() === false` branch,
			// which the "table exists but empty" case above cannot reach.
			await archive.getKnex().schema.dropTableIfExists('page_templates');
		});

		afterAll(async () => {
			await destroyArchive(archive, workingDir);
		});

		it('hasClassification: false と空のclustersを返す（テーブル自体が無い）', async () => {
			const result = await listPageTemplateClusters(archive);

			expect(result).toEqual({ hasClassification: false, clusters: [] });
		});
	});

	describe('テンプレート分類済みのアーカイブ', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_template_clusters_classified__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			archive = await createArchive(workingDir, 'classified.nitpicker');

			// /a, /b: css由来クラスタ（同一CSSセットを共有）
			// /c, /d: path由来クラスタ（CSS参照なし）
			for (const p of ['/a', '/b', '/c', '/d']) {
				await setTestPage(archive, `https://example.com${p}`);
			}

			await archive.setResources({
				url: parseUrl('https://example.com/shared.css')!,
				isExternal: false,
				isError: false,
				status: 200,
				statusText: 'OK',
				contentType: 'text/css',
				contentLength: 200,
				compress: false,
				cdn: false,
				headers: null,
			});
			await archive.setResourcesReferrers({
				url: 'https://example.com/a',
				src: 'https://example.com/shared.css',
			});
			await archive.setResourcesReferrers({
				url: 'https://example.com/b',
				src: 'https://example.com/shared.css',
			});

			await archive.replacePageTemplates(
				new Map([
					['https://example.com/a', '["css:abc123","cluster:0"]'],
					['https://example.com/b', '["css:abc123","cluster:0"]'],
					['https://example.com/c', '["path:news","cluster:0"]'],
					['https://example.com/d', '["path:news","cluster:0"]'],
				]),
			);
		});

		afterAll(async () => {
			await destroyArchive(archive, workingDir);
		});

		it('hasClassification: trueを返す', async () => {
			const result = await listPageTemplateClusters(archive);

			expect(result.hasClassification).toBe(true);
		});

		it('クラスタごとのページ数を正しく返す', async () => {
			const result = await listPageTemplateClusters(archive);

			const cssCluster = result.clusters.find(
				(c) => c.templateKey === '["css:abc123","cluster:0"]',
			);
			const pathCluster = result.clusters.find(
				(c) => c.templateKey === '["path:news","cluster:0"]',
			);
			expect(cssCluster?.pageCount).toBe(2);
			expect(pathCluster?.pageCount).toBe(2);
		});

		it('css由来クラスタは共通CSSの積集合が非空になる', async () => {
			const result = await listPageTemplateClusters(archive);

			const cssCluster = result.clusters.find(
				(c) => c.templateKey === '["css:abc123","cluster:0"]',
			);
			expect(cssCluster?.commonStylesheetUrls).toEqual([
				'https://example.com/shared.css',
			]);
			expect(cssCluster?.commonStylesheetFileNames).toEqual(['shared.css']);
		});

		it('path由来クラスタは共通CSSが空でも共通ディレクトリは機能する', async () => {
			const result = await listPageTemplateClusters(archive);

			const pathCluster = result.clusters.find(
				(c) => c.templateKey === '["path:news","cluster:0"]',
			);
			expect(pathCluster?.commonStylesheetUrls).toEqual([]);
			expect(pathCluster?.commonStylesheetFileNames).toEqual([]);
			expect(pathCluster?.commonDirectories).toEqual([
				{ directory: 'https://example.com/', pageCount: 2 },
			]);
		});

		it('クラスタ選定理由が保存されていない場合はreason: nullを返す', async () => {
			const result = await listPageTemplateClusters(archive);

			for (const cluster of result.clusters) {
				expect(cluster.reason).toBeNull();
			}
		});
	});

	describe('クラスタ選定理由が保存されたアーカイブ', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_template_clusters_with_reason__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			archive = await createArchive(workingDir, 'with-reason.nitpicker');
			await setTestPage(archive, 'https://example.com/a');
			await archive.replacePageTemplates(
				new Map([['https://example.com/a', '["css:abc123","cluster:0"]']]),
				new Map([
					[
						'["css:abc123","cluster:0"]',
						{
							memberCount: 1,
							blocking: [
								{
									blockKey: 'css:abc123',
									reason: { kind: 'css', distinctiveStylesheetHrefs: ['shared.css'] },
								},
							],
							structuralCoreTokens: ['body>header'],
							landmarks: {},
							siblingClusterKeys: [],
						},
					],
				]),
			);
		});

		afterAll(async () => {
			await destroyArchive(archive, workingDir);
		});

		it('保存されたクラスタ選定理由を要約して返す', async () => {
			const result = await listPageTemplateClusters(archive);

			const cluster = result.clusters.find(
				(c) => c.templateKey === '["css:abc123","cluster:0"]',
			);
			expect(cluster?.reason?.clusteredMemberCount).toBe(1);
			expect(cluster?.reason?.distinctiveStylesheetUrls).toEqual(['shared.css']);
		});
	});

	describe('chunk境界(500件)を超えるページ数のクラスタ', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_template_clusters_chunked__',
		);
		let archive: InstanceType<typeof Archive>;
		const pageCount = 520;

		beforeAll(async () => {
			archive = await createArchive(workingDir, 'chunked.nitpicker');

			const templateKeysByUrl = new Map<string, string>();
			for (let i = 0; i < pageCount; i++) {
				const url = `https://example.com/bulk/${i}`;
				await setTestPage(archive, url);
				templateKeysByUrl.set(url, '["path:bulk","cluster:0"]');
			}
			await archive.replacePageTemplates(templateKeysByUrl);
		}, 60_000);

		afterAll(async () => {
			await destroyArchive(archive, workingDir);
		});

		it('500件のwhereInチャンク境界を超えても全ページを正しく解決する', async () => {
			const result = await listPageTemplateClusters(archive);

			const cluster = result.clusters.find(
				(c) => c.templateKey === '["path:bulk","cluster:0"]',
			);
			expect(cluster?.pageCount).toBe(pageCount);
			expect(cluster?.commonDirectories).toEqual([
				{ directory: 'https://example.com/bulk/', pageCount },
			]);
		});
	});
});
