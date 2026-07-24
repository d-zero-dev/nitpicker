import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { ArchiveManager } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../create-app.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
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

/**
 * Builds a fixture archive with two pages and, optionally, a
 * `page_templates` classification, then opens it read-only via an
 * `ArchiveManager` and wires an in-process Hono app to it — mirrors
 * `register-directory-tree-route.spec.ts`'s `buildFixture`.
 * @param workingDir - Unique scratch directory for this fixture.
 * @param classify - Whether to write a `page_templates` classification
 *   before opening read-only.
 * @returns The app and manager — callers must `closeAll()` in `afterAll`.
 */
async function buildFixture(workingDir: string, classify: boolean) {
	const { mkdirSync } = await import('node:fs');
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, 'fixture.nitpicker'),
		cwd: workingDir,
	});
	await archive.setConfig(BASE_CONFIG);
	for (const url of ['https://example.com/a', 'https://example.com/b']) {
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
			html: '<html></html>',
			meta: META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	}

	if (classify) {
		await archive.replacePageTemplates(
			new Map([
				['https://example.com/a', '["path:top","cluster:0"]'],
				['https://example.com/b', '["path:top","cluster:0"]'],
			]),
		);
	}

	const manager = new ArchiveManager();
	const { archiveId, mode } = await manager.open(archive.tmpDir);
	const app = createApp({
		context: {
			manager,
			archiveId,
			filePath: archive.tmpDir,
			mode,
			crawlerLockHolder: null,
		},
		publicDir: '/tmp/no-such-dir-register-template-clusters-route-spec',
	});
	return { app, manager };
}

describe('registerTemplateClustersRoute (integration)', () => {
	describe('--templates分類済み', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_template_clusters_route_classified__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, true);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('hasClassification: trueとクラスタ一覧を返す', async () => {
			const res = await fixture.app.request('/api/template-clusters');
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				hasClassification: boolean;
				clusters: { templateKey: string; pageCount: number }[];
			};
			expect(body.hasClassification).toBe(true);
			expect(body.clusters).toHaveLength(1);
			expect(body.clusters[0]).toMatchObject({
				templateKey: '["path:top","cluster:0"]',
				pageCount: 2,
			});
		});
	});

	describe('--templates未実行', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_register_template_clusters_route_unclassified__',
		);
		let fixture: Awaited<ReturnType<typeof buildFixture>>;

		beforeAll(async () => {
			fixture = await buildFixture(workingDir, false);
		});

		afterAll(async () => {
			await fixture.manager.closeAll();
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('500ではなくhasClassification: falseと空配列を返す', async () => {
			const res = await fixture.app.request('/api/template-clusters');
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ hasClassification: false, clusters: [] });
		});
	});
});
