import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { planResourceItems } from './plan-resource-items.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'plan-resources-source.sqlite');
const destFile = path.resolve(workingDir, 'plan-resources-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('planResourceItems', () => {
	it('concat: full for a new URL, replace when source has data the dest lacks, skip otherwise', async () => {
		const dest = await buildFullSchemaTestDb(destFile);
		const [existingNoStatus] = await dest('url_refs')
			.insert({ url: 'https://example.com/style-a.css' })
			.returning('id');
		await dest('resource_items').insert({
			url_id: existingNoStatus.id,
			is_external: 0,
			status: null,
		});
		const [existingWithStatus] = await dest('url_refs')
			.insert({ url: 'https://example.com/style-b.css' })
			.returning('id');
		await dest('resource_items').insert({
			url_id: existingWithStatus.id,
			is_external: 0,
			status: 200,
		});

		const source = await buildFullSchemaTestDb(sourceFile, null);
		const [urlA] = await source('url_refs')
			.insert({ url: 'https://example.com/style-a.css' })
			.returning('id');
		const [resourceA] = await source('resource_items')
			.insert({ url_id: urlA.id, is_external: 0, status: 200 })
			.returning('id');
		const [urlB] = await source('url_refs')
			.insert({ url: 'https://example.com/style-b.css' })
			.returning('id');
		const [resourceB] = await source('resource_items')
			.insert({ url_id: urlB.id, is_external: 0, status: null })
			.returning('id');
		const [urlC] = await source('url_refs')
			.insert({ url: 'https://example.com/style-c.css' })
			.returning('id');
		const [resourceC] = await source('resource_items')
			.insert({ url_id: urlC.id, is_external: 0, status: 200 })
			.returning('id');
		await source.destroy();

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await planResourceItems(dest, 'concat');
			const rows: { src_id: number; action: number }[] = await dest
				.select('src_id', 'action')
				.from('xfer_ri_plan')
				.orderBy('src_id');
			const byId = new Map(rows.map((r) => [r.src_id, r.action]));
			expect(byId.get(resourceA.id)).toBe(TRANSFER_ACTION.replace);
			expect(byId.get(resourceB.id)).toBe(TRANSFER_ACTION.skip);
			expect(byId.get(resourceC.id)).toBe(TRANSFER_ACTION.full);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('split: keeps only resources referenced by a full-action page, drops orphans', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const keptPage = await seedContentItem(source, 'https://example.com/blog/', {
			scraped: 1,
			isExternal: 0,
		});
		const droppedPage = await seedContentItem(source, 'https://example.com/elsewhere/', {
			scraped: 1,
			isExternal: 0,
		});
		const [usedUrl] = await source('url_refs')
			.insert({ url: 'https://example.com/used.css' })
			.returning('id');
		const [usedResource] = await source('resource_items')
			.insert({ url_id: usedUrl.id, is_external: 0 })
			.returning('id');
		const [orphanUrl] = await source('url_refs')
			.insert({ url: 'https://example.com/orphan.css' })
			.returning('id');
		const [orphanResource] = await source('resource_items')
			.insert({ url_id: orphanUrl.id, is_external: 0 })
			.returning('id');
		await source('resource_ref_edges').insert([
			{ resource_id: usedResource.id, page_id: keptPage, count: 1 },
			{ resource_id: orphanResource.id, page_id: droppedPage, count: 1 },
		]);
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			// Simulate a split content-item plan where only `keptPage` is full.
			await dest('xfer_ci_plan').insert({
				src_id: keptPage,
				action: TRANSFER_ACTION.full,
			});
			await planResourceItems(dest, 'split');
			const rows = await dest.select('src_id').from('xfer_ri_plan');
			expect(rows.map((r) => r.src_id)).toEqual([usedResource.id]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
