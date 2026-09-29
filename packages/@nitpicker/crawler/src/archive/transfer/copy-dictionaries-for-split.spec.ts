import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyDictionariesForSplit } from './copy-dictionaries-for-split.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-dict-split-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-dict-split-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyDictionariesForSplit', () => {
	it('copies only dictionary rows referenced by full pages, never stub or dropped pages', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const keptPage = await seedContentItem(source, 'https://example.com/blog/');
		const stubPage = await seedContentItem(source, 'https://example.com/referenced/');
		const droppedPage = await seedContentItem(source, 'https://example.com/dropped/');

		const [keptTitle] = await source('text_refs')
			.insert({ hash: Buffer.from('01', 'hex'), text: 'Kept Title' })
			.returning('id');
		await source('page_meta').insert({ page_id: keptPage, title_text_id: keptTitle.id });

		const [stubTitle] = await source('text_refs')
			.insert({ hash: Buffer.from('02', 'hex'), text: 'Referenced Title' })
			.returning('id');
		await source('page_meta').insert({ page_id: stubPage, title_text_id: stubTitle.id });

		const [droppedTitle] = await source('text_refs')
			.insert({ hash: Buffer.from('03', 'hex'), text: 'Dropped Title' })
			.returning('id');
		await source('page_meta').insert({
			page_id: droppedPage,
			title_text_id: droppedTitle.id,
		});
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert([
				{ src_id: keptPage, action: TRANSFER_ACTION.full },
				{ src_id: stubPage, action: TRANSFER_ACTION.stub },
			]);
			// droppedPage intentionally absent from the plan.

			await copyDictionariesForSplit(dest);

			const texts = await dest('text_refs').select('text');
			expect(texts.map((t) => t.text)).toEqual(['Kept Title']);

			// Both kept and stub pages' own url_id is a content-item-level
			// need (a stub still carries its own identity URL).
			const urls = await dest('url_refs').select('url');
			expect(urls.map((u) => u.url).toSorted()).toEqual([
				'https://example.com/blog/',
				'https://example.com/referenced/',
			]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
