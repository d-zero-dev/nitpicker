import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyPageTemplateClusters } from './copy-page-template-clusters.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-template-clusters-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-template-clusters-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyPageTemplateClusters', () => {
	it('copies a referenced cluster and recomputes member_count from the destination page_templates', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const keptPage = await seedContentItem(source, 'https://example.com/kept/');
		const droppedPage = await seedContentItem(source, 'https://example.com/dropped/');
		await source('page_templates').insert([
			{ page_id: keptPage, template_key: 'css:abc123' },
			{ page_id: droppedPage, template_key: 'css:zzz999' },
		]);
		await source('page_template_clusters').insert([
			{
				template_key: 'css:abc123',
				member_count: 5,
				reason_json: Buffer.from('{}'),
				codec: 'none',
				size_raw: 2,
				size_stored: 2,
			},
			{
				template_key: 'css:zzz999',
				member_count: 1,
				reason_json: Buffer.from('{}'),
				codec: 'none',
				size_raw: 2,
				size_stored: 2,
			},
		]);
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destKeptPage = await seedContentItem(dest, 'https://example.com/kept/');
		// Only the kept page's page_templates row exists in the destination —
		// this is what copySimplePageScopedTables would have already copied.
		await dest('page_templates').insert({
			page_id: destKeptPage,
			template_key: 'css:abc123',
		});

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert({
				src_id: keptPage,
				action: TRANSFER_ACTION.full,
				dest_id: destKeptPage,
			});
			// droppedPage intentionally absent from the plan.

			await copyPageTemplateClusters(dest);

			const clusters = await dest('page_template_clusters').select(
				'template_key',
				'member_count',
			);
			// Only the referenced cluster is copied, and its member_count is
			// recomputed against the destination's own (smaller) page set — not
			// carried over verbatim from the source's `5`.
			expect(clusters).toEqual([{ template_key: 'css:abc123', member_count: 1 }]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
