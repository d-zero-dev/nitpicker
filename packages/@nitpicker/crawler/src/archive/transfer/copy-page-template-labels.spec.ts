import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyPageTemplateLabels } from './copy-page-template-labels.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-template-labels-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-template-labels-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyPageTemplateLabels', () => {
	it('copies the label of a referenced cluster and drops the label of a cluster with no kept page', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const keptPage = await seedContentItem(source, 'https://example.com/kept/');
		const droppedPage = await seedContentItem(source, 'https://example.com/dropped/');
		await source('page_templates').insert([
			{ page_id: keptPage, template_key: 'css:abc123' },
			{ page_id: droppedPage, template_key: 'css:zzz999' },
		]);
		await source('page_template_labels').insert([
			{ template_key: 'css:abc123', section: 'kept', ordinal: 2 },
			{ template_key: 'css:zzz999', section: null, ordinal: 1 },
		]);
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destKeptPage = await seedContentItem(dest, 'https://example.com/kept/');
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

			await copyPageTemplateLabels(dest);

			const labels = await dest('page_template_labels').select('*');
			expect(labels).toEqual([
				{ template_key: 'css:abc123', section: 'kept', ordinal: 2 },
			]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('renumbers a label that collides with one already in the destination so no two templates share a name', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const page = await seedContentItem(source, 'https://example.com/events/src');
		await source('page_templates').insert({ page_id: page, template_key: 'css:source' });
		await source('page_template_labels').insert({
			template_key: 'css:source',
			section: 'events',
			ordinal: 1,
		});
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destOwnPage = await seedContentItem(dest, 'https://example.com/events/dest');
		const destSrcPage = await seedContentItem(dest, 'https://example.com/events/src');
		await dest('page_templates').insert([
			{ page_id: destOwnPage, template_key: 'css:dest' },
			{ page_id: destSrcPage, template_key: 'css:source' },
		]);
		await dest('page_template_labels').insert({
			template_key: 'css:dest',
			section: 'events',
			ordinal: 1,
		});

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert({
				src_id: page,
				action: TRANSFER_ACTION.full,
				dest_id: destSrcPage,
			});

			await copyPageTemplateLabels(dest);

			const labels = await dest('page_template_labels')
				.select('*')
				.orderBy('template_key');
			expect(labels).toEqual([
				{ template_key: 'css:dest', section: 'events', ordinal: 1 },
				{ template_key: 'css:source', section: 'events', ordinal: 2 },
			]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('contributes no labels, without failing, from a source that has no page_template_labels table', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const page = await seedContentItem(source, 'https://example.com/kept/');
		await source('page_templates').insert({ page_id: page, template_key: 'css:abc123' });
		await source.schema.dropTable('page_template_labels');
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destPage = await seedContentItem(dest, 'https://example.com/kept/');
		await dest('page_templates').insert({
			page_id: destPage,
			template_key: 'css:abc123',
		});

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert({
				src_id: page,
				action: TRANSFER_ACTION.full,
				dest_id: destPage,
			});

			await copyPageTemplateLabels(dest);

			expect(await dest('page_template_labels').select('*')).toEqual([]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('keeps the destination label on a template_key collision (first source wins)', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const page = await seedContentItem(source, 'https://example.com/b/');
		await source('page_templates').insert({ page_id: page, template_key: 'css:abc123' });
		await source('page_template_labels').insert({
			template_key: 'css:abc123',
			section: 'b',
			ordinal: 1,
		});
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destPageA = await seedContentItem(dest, 'https://example.com/a/');
		const destPageB = await seedContentItem(dest, 'https://example.com/b/');
		await dest('page_templates').insert([
			{ page_id: destPageA, template_key: 'css:abc123' },
			{ page_id: destPageB, template_key: 'css:abc123' },
		]);
		await dest('page_template_labels').insert({
			template_key: 'css:abc123',
			section: 'a',
			ordinal: 1,
		});

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert({
				src_id: page,
				action: TRANSFER_ACTION.full,
				dest_id: destPageB,
			});

			await copyPageTemplateLabels(dest);

			const labels = await dest('page_template_labels').select('*');
			expect(labels).toEqual([{ template_key: 'css:abc123', section: 'a', ordinal: 1 }]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
