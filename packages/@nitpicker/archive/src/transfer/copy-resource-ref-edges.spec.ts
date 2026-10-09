import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyResourceRefEdges } from './copy-resource-ref-edges.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-resource-ref-edges-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-resource-ref-edges-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyResourceRefEdges', () => {
	it('remaps both endpoints and drops an edge whose resource was not kept', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const page = await seedContentItem(source, 'https://example.com/');
		const [keptUrl] = await source('url_refs')
			.insert({ url: 'https://example.com/kept.css' })
			.returning('id');
		const [keptResource] = await source('resource_items')
			.insert({ url_id: keptUrl.id, is_external: 0 })
			.returning('id');
		const [droppedUrl] = await source('url_refs')
			.insert({ url: 'https://example.com/dropped.css' })
			.returning('id');
		const [droppedResource] = await source('resource_items')
			.insert({ url_id: droppedUrl.id, is_external: 0 })
			.returning('id');
		await source('resource_ref_edges').insert([
			{ resource_id: keptResource.id, page_id: page, count: 3 },
			{ resource_id: droppedResource.id, page_id: page, count: 1 },
		]);
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destPage = await seedContentItem(dest, 'https://example.com/');
		const [destUrl] = await dest('url_refs')
			.insert({ url: 'https://example.com/kept.css' })
			.returning('id');
		const [destResource] = await dest('resource_items')
			.insert({ url_id: destUrl.id, is_external: 0 })
			.returning('id');

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert({
				src_id: page,
				action: TRANSFER_ACTION.full,
				dest_id: destPage,
			});
			await dest('xfer_ri_plan').insert({
				src_id: keptResource.id,
				action: TRANSFER_ACTION.full,
				dest_id: destResource.id,
			});
			// droppedResource intentionally absent from xfer_ri_plan.

			await copyResourceRefEdges(dest);

			const rows = await dest('resource_ref_edges').select(
				'resource_id',
				'page_id',
				'count',
			);
			expect(rows).toEqual([
				{ resource_id: destResource.id, page_id: destPage, count: 3 },
			]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
