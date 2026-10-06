import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getResourceHostInventory } from './get-resource-host-inventory.js';
import { createResourceFixtureArchive } from './test-helpers/create-resource-fixture-archive.js';

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_get_resource_host_inventory__',
);

describe('getResourceHostInventory', () => {
	let archive: Awaited<ReturnType<typeof createResourceFixtureArchive>>;

	beforeAll(async () => {
		archive = await createResourceFixtureArchive(workingDir, 'resource-hosts.nitpicker');
	});

	afterAll(async () => {
		await archive?.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('ホストごとにリソース数・参照ページ数・カテゴリ内訳を集計し、リソース数の降順で返す', async () => {
		const result = await getResourceHostInventory(archive);
		expect(result.total).toBe(3);
		expect(result.items.map((item) => item.host)).toEqual([
			'example.com',
			'cdn.example.com',
			'fonts.example.net',
		]);
		expect(result.items[0]).toMatchObject({
			host: 'example.com',
			isExternal: false,
			resourceCount: 2,
			pageCount: 3,
			categories: { css: 1, font: 1 },
		});
		expect(result.items[2]).toMatchObject({
			host: 'fonts.example.net',
			isExternal: true,
			resourceCount: 1,
			pageCount: 2,
			categories: { font: 1 },
		});
	});

	it('isExternal で絞り込む', async () => {
		const result = await getResourceHostInventory(archive, { isExternal: true });
		expect(result.items.map((item) => item.host).toSorted()).toEqual([
			'cdn.example.com',
			'fonts.example.net',
		]);
	});

	it('sortBy host は昇順、pageCount は降順が既定', async () => {
		const byHost = await getResourceHostInventory(archive, { sortBy: 'host' });
		expect(byHost.items.map((item) => item.host)).toEqual([
			'cdn.example.com',
			'example.com',
			'fonts.example.net',
		]);

		const byPages = await getResourceHostInventory(archive, { sortBy: 'pageCount' });
		expect(byPages.items[0]!.host).toBe('example.com');
	});

	it('offset / limit でスライスし、total はホスト総数', async () => {
		const result = await getResourceHostInventory(archive, { limit: 1, offset: 1 });
		expect(result.items).toHaveLength(1);
		expect(result.total).toBe(3);
	});
});
