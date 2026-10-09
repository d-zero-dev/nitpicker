import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyImageItems } from './copy-image-items.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-image-items-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-image-items-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyImageItems', () => {
	it('remaps src/alt/dom-path ids independently and skips stub/skip pages', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const fullPage = await seedContentItem(source, 'https://example.com/full/');
		const stubPage = await seedContentItem(source, 'https://example.com/stub/');
		const [srcUrl] = await source('url_refs')
			.insert({ url: 'https://example.com/photo.jpg' })
			.returning('id');
		const [altText] = await source('text_refs')
			.insert({ hash: Buffer.from('01', 'hex'), text: 'Alt text' })
			.returning('id');
		const [domPathText] = await source('text_refs')
			.insert({ hash: Buffer.from('02', 'hex'), text: 'img[0]' })
			.returning('id');
		await source('image_items').insert([
			{
				page_id: fullPage,
				src_url_id: srcUrl.id,
				alt_text_id: altText.id,
				dom_path_text_id: domPathText.id,
			},
			{
				page_id: stubPage,
				src_url_id: srcUrl.id,
				alt_text_id: altText.id,
				dom_path_text_id: domPathText.id,
			},
		]);
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destFullPage = await seedContentItem(dest, 'https://example.com/full/');
		const destStubPage = await seedContentItem(dest, 'https://example.com/stub/', {
			isExternal: 1,
			isTarget: 0,
		});
		const [destSrcUrl] = await dest('url_refs')
			.insert({ url: 'https://example.com/photo.jpg' })
			.returning('id');
		const [destAltText] = await dest('text_refs')
			.insert({ hash: Buffer.from('01', 'hex'), text: 'Alt text' })
			.returning('id');
		const [destDomPathText] = await dest('text_refs')
			.insert({ hash: Buffer.from('02', 'hex'), text: 'img[0]' })
			.returning('id');

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_map_url_refs').insert({
				src_id: srcUrl.id,
				dest_id: destSrcUrl.id,
			});
			await dest('xfer_map_text_refs').insert([
				{ src_id: altText.id, dest_id: destAltText.id },
				{ src_id: domPathText.id, dest_id: destDomPathText.id },
			]);
			await dest('xfer_ci_plan').insert([
				{
					src_id: fullPage,
					action: TRANSFER_ACTION.full,
					dest_id: destFullPage,
				},
				{
					src_id: stubPage,
					action: TRANSFER_ACTION.stub,
					dest_id: destStubPage,
				},
			]);

			await copyImageItems(dest);

			const rows = await dest('image_items').select('page_id');
			expect(rows).toEqual([{ page_id: destFullPage }]);
			const row = await dest('image_items').where('page_id', destFullPage).first();
			expect(row.src_url_id).toBe(destSrcUrl.id);
			expect(row.alt_text_id).toBe(destAltText.id);
			expect(row.dom_path_text_id).toBe(destDomPathText.id);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
