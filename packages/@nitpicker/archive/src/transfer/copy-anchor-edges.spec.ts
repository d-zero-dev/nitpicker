import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyAnchorEdges } from './copy-anchor-edges.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-anchor-edges-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-anchor-edges-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyAnchorEdges', () => {
	it('remaps both endpoints and drops an edge whose target is not in the plan', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const from = await seedContentItem(source, 'https://example.com/from/');
		const to = await seedContentItem(source, 'https://example.com/to/');
		const droppedTarget = await seedContentItem(source, 'https://example.com/dropped/');
		await source('anchor_edges').insert([
			{ page_id: from, href_page_id: to, count: 2 },
			{ page_id: from, href_page_id: droppedTarget, count: 1 },
		]);
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destFrom = await seedContentItem(dest, 'https://example.com/from/');
		const destTo = await seedContentItem(dest, 'https://example.com/to/');

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert([
				{ src_id: from, action: TRANSFER_ACTION.full, dest_id: destFrom },
				{ src_id: to, action: TRANSFER_ACTION.full, dest_id: destTo },
				// droppedTarget intentionally absent from the plan.
			]);

			await copyAnchorEdges(dest);

			const rows = await dest('anchor_edges').select('page_id', 'href_page_id', 'count');
			expect(rows).toEqual([{ page_id: destFrom, href_page_id: destTo, count: 2 }]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
