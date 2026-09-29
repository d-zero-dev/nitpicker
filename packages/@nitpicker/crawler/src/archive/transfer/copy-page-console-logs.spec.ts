import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyPageConsoleLogs } from './copy-page-console-logs.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-page-console-logs-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-page-console-logs-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyPageConsoleLogs', () => {
	it('remaps consoleLogId through the dictionary map', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const page = await seedContentItem(source, 'https://example.com/');
		const [logItem] = await source('console_log_items')
			.insert({ hash: Buffer.from('01', 'hex'), type: 'error' })
			.returning('id');
		await source('page_console_logs').insert({
			pageId: page,
			consoleLogId: logItem.id,
			ts: 1000,
		});
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destPage = await seedContentItem(dest, 'https://example.com/');
		const [destLogItem] = await dest('console_log_items')
			.insert({ hash: Buffer.from('01', 'hex'), type: 'error' })
			.returning('id');

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_map_console_log_items').insert({
				src_id: logItem.id,
				dest_id: destLogItem.id,
			});
			await dest('xfer_ci_plan').insert({
				src_id: page,
				action: TRANSFER_ACTION.full,
				dest_id: destPage,
			});

			await copyPageConsoleLogs(dest);

			const row = await dest('page_console_logs').first();
			expect(row.pageId).toBe(destPage);
			expect(row.consoleLogId).toBe(destLogItem.id);
			expect(row.ts).toBe(1000);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
