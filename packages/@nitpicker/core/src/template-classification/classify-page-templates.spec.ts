import { utimes } from 'node:fs/promises';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { classifyPageTemplates } from './classify-page-templates.js';

vi.mock('@d-zero/page-cluster/resolve-page-cluster-keys', async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import('@d-zero/page-cluster/resolve-page-cluster-keys')
		>();
	return {
		...actual,
		resolvePageClusterKeys: vi.fn(actual.resolvePageClusterKeys),
	};
});

const { resolvePageClusterKeys } =
	await import('@d-zero/page-cluster/resolve-page-cluster-keys');

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_classify_page_templates__');

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

const ARTICLE_TEMPLATE_A = `<html><body><header class="site-header"></header><main><article><h1>Title A</h1><p>Body text A</p></article></main><footer class="site-footer"></footer></body></html>`;
const ARTICLE_TEMPLATE_B = `<html><body><header class="site-header"></header><main><article><h1>Title B</h1><p>Body text B, quite different wording</p></article></main><footer class="site-footer"></footer></body></html>`;
const LIST_TEMPLATE_C = `<html><body><nav class="site-nav"></nav><section><ul><li>one</li><li>two</li><li>three</li></ul></section></body></html>`;

describe('classifyPageTemplates', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'classify-page-templates-test.nitpicker',
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

		for (const [p, html] of [
			['/article-1', ARTICLE_TEMPLATE_A],
			['/article-2', ARTICLE_TEMPLATE_B],
			['/list', LIST_TEMPLATE_C],
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

		// Real file, so it has real, distinct stat() output for the cache key.
		await archive.write();
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('同一テンプレートのページには同じtemplateKeyを、別テンプレートのページには異なるtemplateKeyを割り当てる', async () => {
		const pages = await archive.getPages();
		const result = await classifyPageTemplates({ archive, pages });

		const keyA = result.get('https://example.com/article-1');
		const keyB = result.get('https://example.com/article-2');
		const keyC = result.get('https://example.com/list');

		expect(keyA).toBeDefined();
		expect(keyA).toBe(keyB);
		expect(keyC).toBeDefined();
		expect(keyC).not.toBe(keyA);
	});

	it('同一アーカイブへの繰り返し呼び出しはキャッシュヒットし、mtime変更で再計算される', async () => {
		const pages = await archive.getPages();

		// Prime the cache for the archive's current stat (hit-or-miss here
		// depends on test execution order with the previous `it`, which is
		// exactly why this test only asserts relative behavior from this
		// point on, not the state of this first call).
		await classifyPageTemplates({ archive, pages });

		vi.mocked(resolvePageClusterKeys).mockClear();
		const cached = await classifyPageTemplates({ archive, pages });
		expect(resolvePageClusterKeys).not.toHaveBeenCalled();

		const future = new Date(Date.now() + 60_000);
		await utimes(archiveFilePath, future, future);

		vi.mocked(resolvePageClusterKeys).mockClear();
		const recomputed = await classifyPageTemplates({ archive, pages });
		expect(resolvePageClusterKeys).toHaveBeenCalledTimes(1);
		expect(Object.fromEntries(recomputed)).toEqual(Object.fromEntries(cached));
	});

	it('ファイルのsize/mtimeが同じでもページ数が変わればキャッシュが無効化される', async () => {
		const pages = await archive.getPages();

		await classifyPageTemplates({ archive, pages });

		// Same archive file (same size/mtime) but a different page count —
		// simulates the cache-key component this run added specifically to
		// catch the "same stat, different content" gap that size+mtime alone
		// cannot.
		vi.mocked(resolvePageClusterKeys).mockClear();
		await classifyPageTemplates({ archive, pages: pages.slice(0, 2) });
		expect(resolvePageClusterKeys).toHaveBeenCalledTimes(1);
	});

	it('resolvePageClusterKeysの戻り値件数がページ数と食い違う場合はエラーを投げる', async () => {
		const pages = await archive.getPages();

		// Force a fresh computation (not a cache hit from an earlier test) so
		// the mocked bad return value below is actually exercised.
		const future = new Date(Date.now() + 120_000);
		await utimes(archiveFilePath, future, future);
		vi.mocked(resolvePageClusterKeys).mockResolvedValueOnce(['only-one-key']);

		await expect(classifyPageTemplates({ archive, pages })).rejects.toThrow(
			/resolvePageClusterKeys returned/,
		);
	});
});
