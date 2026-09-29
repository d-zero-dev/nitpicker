import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyPageHtmlBlobs } from './copy-page-html-blobs.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-html-blobs-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-html-blobs-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyPageHtmlBlobs', () => {
	it('copies only blobs referenced by a kept (full) page, not a dropped one', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const keptPage = await seedContentItem(source, 'https://example.com/kept/');
		const droppedPage = await seedContentItem(source, 'https://example.com/dropped/');
		const keptHash = Buffer.from('01', 'hex');
		const droppedHash = Buffer.from('02', 'hex');
		await source('page_html_blobs').insert([
			{
				hash: keptHash,
				body: Buffer.from('kept'),
				codec: 'none',
				size_raw: 4,
				size_stored: 4,
			},
			{
				hash: droppedHash,
				body: Buffer.from('dropped'),
				codec: 'none',
				size_raw: 7,
				size_stored: 7,
			},
		]);
		await source('page_html_ref').insert([
			{ page_id: keptPage, hash: keptHash },
			{ page_id: droppedPage, hash: droppedHash },
		]);
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert({
				src_id: keptPage,
				action: TRANSFER_ACTION.full,
			});
			await copyPageHtmlBlobs(dest);
			const blobs = await dest('page_html_blobs').select('hash');
			expect(blobs).toHaveLength(1);
			expect(Buffer.from(blobs[0].hash)).toEqual(keptHash);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
