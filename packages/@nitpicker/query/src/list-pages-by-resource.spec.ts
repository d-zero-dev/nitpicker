import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listPagesByResource } from './list-pages-by-resource.js';
import { createResourceFixtureArchive } from './test-helpers/create-resource-fixture-archive.js';

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_list_pages_by_resource__',
);

describe('listPagesByResource', () => {
	let archive: Awaited<ReturnType<typeof createResourceFixtureArchive>>;

	beforeAll(async () => {
		archive = await createResourceFixtureArchive(
			workingDir,
			'pages-by-resource.nitpicker',
		);
	});

	afterAll(async () => {
		await archive?.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('font カテゴリのリソースを読み込むページを、一致リソース数・URL サンプル付きで返す', async () => {
		const result = await listPagesByResource(archive, { contentTypeCategory: 'font' });
		expect(result.total).toBe(2);
		expect(result.items).toEqual([
			{
				url: 'https://example.com',
				matchedResourceCount: 2,
				matchedResources: [
					'https://example.com/fonts/local.woff',
					'https://fonts.example.net/s/samplesans.woff2',
				],
			},
			{
				url: 'https://example.com/about',
				matchedResourceCount: 1,
				matchedResources: ['https://fonts.example.net/s/samplesans.woff2'],
			},
		]);
	});

	it('urlPattern でリソース URL を絞る', async () => {
		const result = await listPagesByResource(archive, { urlPattern: '%example.net%' });
		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com',
			'https://example.com/about',
		]);
	});

	it('urlPattern と contentTypeCategory は AND、isExternal も併用できる', async () => {
		const none = await listPagesByResource(archive, {
			urlPattern: '%app.js',
			contentTypeCategory: 'font',
		});
		expect(none.total).toBe(0);

		const internalFonts = await listPagesByResource(archive, {
			contentTypeCategory: 'font',
			isExternal: false,
		});
		expect(internalFonts.items.map((item) => item.url)).toEqual(['https://example.com']);
	});

	it('status でリソースの HTTP status を絞り込む', async () => {
		const ok = await listPagesByResource(archive, {
			contentTypeCategory: 'font',
			status: 200,
		});
		expect(ok.total).toBe(2);

		const notFound = await listPagesByResource(archive, {
			contentTypeCategory: 'font',
			status: 404,
		});
		expect(notFound.total).toBe(0);
		expect(notFound.items).toEqual([]);
	});

	it('resourcesLimit でサンプル URL 数を絞っても matchedResourceCount は全件を数える', async () => {
		const result = await listPagesByResource(archive, {
			contentTypeCategory: 'font',
			resourcesLimit: 1,
		});
		expect(result.items[0]).toMatchObject({
			matchedResourceCount: 2,
			matchedResources: ['https://example.com/fonts/local.woff'],
		});
	});

	it('offset / limit でページをスライスし、total は全体件数のまま', async () => {
		const result = await listPagesByResource(archive, {
			contentTypeCategory: 'css',
			limit: 1,
			offset: 1,
		});
		expect(result.total).toBe(3);
		expect(result.items.map((item) => item.url)).toEqual(['https://example.com/about']);
	});

	it('urlPattern も contentTypeCategory も無ければ throw する', async () => {
		await expect(listPagesByResource(archive, { isExternal: true })).rejects.toThrow(
			/urlPattern or contentTypeCategory/,
		);
	});
});
