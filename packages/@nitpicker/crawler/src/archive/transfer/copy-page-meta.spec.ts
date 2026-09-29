import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyPageMeta } from './copy-page-meta.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-page-meta-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-page-meta-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyPageMeta', () => {
	it('remaps distinct url/text/json FK columns to their own destination ids', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const page = await seedContentItem(source, 'https://example.com/page/');
		const [title] = await source('text_refs')
			.insert({ hash: Buffer.from('01', 'hex'), text: 'Title' })
			.returning('id');
		const [description] = await source('text_refs')
			.insert({ hash: Buffer.from('02', 'hex'), text: 'Description' })
			.returning('id');
		const [canonical] = await source('url_refs')
			.insert({ url: 'https://example.com/canonical' })
			.returning('id');
		const [extras] = await source('json_refs')
			.insert({
				hash: Buffer.from('03', 'hex'),
				json_text: '{}',
				codec: 'none',
				size_raw: 2,
				size_stored: 2,
			})
			.returning('id');
		await source('page_meta').insert({
			page_id: page,
			title_text_id: title.id,
			description_text_id: description.id,
			canonical_url_id: canonical.id,
			meta_extras_json_id: extras.id,
			lang: 'ja',
		});
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destPage = await seedContentItem(dest, 'https://example.com/page/');
		const [destTitle] = await dest('text_refs')
			.insert({ hash: Buffer.from('01', 'hex'), text: 'Title' })
			.returning('id');
		const [destDescription] = await dest('text_refs')
			.insert({ hash: Buffer.from('02', 'hex'), text: 'Description' })
			.returning('id');
		const [destCanonical] = await dest('url_refs')
			.insert({ url: 'https://example.com/canonical' })
			.returning('id');
		const [destExtras] = await dest('json_refs')
			.insert({
				hash: Buffer.from('03', 'hex'),
				json_text: '{}',
				codec: 'none',
				size_raw: 2,
				size_stored: 2,
			})
			.returning('id');

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_map_text_refs').insert([
				{ src_id: title.id, dest_id: destTitle.id },
				{ src_id: description.id, dest_id: destDescription.id },
			]);
			await dest('xfer_map_url_refs').insert({
				src_id: canonical.id,
				dest_id: destCanonical.id,
			});
			await dest('xfer_map_json_refs').insert({
				src_id: extras.id,
				dest_id: destExtras.id,
			});
			await dest('xfer_ci_plan').insert({
				src_id: page,
				action: TRANSFER_ACTION.full,
				dest_id: destPage,
			});

			await copyPageMeta(dest);

			const row = await dest('page_meta').where('page_id', destPage).first();
			expect(row.title_text_id).toBe(destTitle.id);
			expect(row.description_text_id).toBe(destDescription.id);
			expect(row.canonical_url_id).toBe(destCanonical.id);
			expect(row.meta_extras_json_id).toBe(destExtras.id);
			expect(row.lang).toBe('ja');
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
