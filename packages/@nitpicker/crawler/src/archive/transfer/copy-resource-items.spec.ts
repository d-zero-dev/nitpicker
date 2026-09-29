import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyResourceItems } from './copy-resource-items.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-resource-items-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-resource-items-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyResourceItems', () => {
	it('inserts a full resource, backfills dest_id, replaces an existing one, and copies the js scan cache', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const [newUrl] = await source('url_refs')
			.insert({ url: 'https://example.com/new.css' })
			.returning('id');
		const [newResource] = await source('resource_items')
			.insert({ url_id: newUrl.id, is_external: 0, status: 200 })
			.returning('id');
		const [replacedUrl] = await source('url_refs')
			.insert({ url: 'https://example.com/replaced.js' })
			.returning('id');
		const [replacedResource] = await source('resource_items')
			.insert({ url_id: replacedUrl.id, is_external: 0, status: 200, cdn: 'cloudflare' })
			.returning('id');
		await source('technology_js_scan_cache').insert({
			resourceId: replacedResource.id,
			scannedAt: 1000,
			technology: 'jQuery',
		});
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const [destReplacedUrl] = await dest('url_refs')
			.insert({ url: 'https://example.com/replaced.js' })
			.returning('id');
		const [destReplacedResource] = await dest('resource_items')
			.insert({ url_id: destReplacedUrl.id, is_external: 0, status: null })
			.returning('id');

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			const [destNewUrl] = await dest('url_refs')
				.insert({ url: 'https://example.com/new.css' })
				.returning('id');
			await dest('xfer_map_url_refs').insert({
				src_id: newUrl.id,
				dest_id: destNewUrl.id,
			});
			await dest('xfer_ri_plan').insert([
				{ src_id: newResource.id, action: TRANSFER_ACTION.full },
				{
					src_id: replacedResource.id,
					action: TRANSFER_ACTION.replace,
					dest_id: destReplacedResource.id,
				},
			]);

			await copyResourceItems(dest);

			const newRow = await dest
				.select('status')
				.from('resource_items')
				.join('url_refs', 'url_refs.id', 'resource_items.url_id')
				.where('url_refs.url', 'https://example.com/new.css')
				.first();
			expect(newRow.status).toBe(200);

			const newPlanRow = await dest('xfer_ri_plan')
				.where('src_id', newResource.id)
				.first();
			expect(newPlanRow.dest_id).not.toBeNull();

			const replacedRow = await dest('resource_items')
				.where('id', destReplacedResource.id)
				.first();
			expect(replacedRow.status).toBe(200);
			expect(replacedRow.cdn).toBe('cloudflare');

			const cacheRow = await dest('technology_js_scan_cache')
				.where('resourceId', destReplacedResource.id)
				.first();
			expect(cacheRow.technology).toBe('jQuery');
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
