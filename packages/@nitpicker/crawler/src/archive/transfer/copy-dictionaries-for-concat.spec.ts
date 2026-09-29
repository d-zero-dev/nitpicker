import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyDictionariesForConcat } from './copy-dictionaries-for-concat.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-dict-concat-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-dict-concat-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyDictionariesForConcat', () => {
	it('copies every dictionary row and maps src ids to (new or pre-existing) dest ids', async () => {
		const dest = await buildFullSchemaTestDb(destFile);
		const [existingUrlRef] = await dest('url_refs')
			.insert({ url: 'https://example.com/shared' })
			.returning('id');

		const source = await buildFullSchemaTestDb(sourceFile, null);
		const [sharedUrlRef] = await source('url_refs')
			.insert({ url: 'https://example.com/shared' })
			.returning('id');
		const [newUrlRef] = await source('url_refs')
			.insert({ url: 'https://example.com/only-in-source' })
			.returning('id');
		await source.destroy();

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await copyDictionariesForConcat(dest);

			// The shared URL must map to the ALREADY-EXISTING dest row, not a
			// duplicate — ON CONFLICT DO NOTHING plus natural-key remap is the
			// whole point.
			const sharedMap = await dest('xfer_map_url_refs')
				.where('src_id', sharedUrlRef.id)
				.first();
			expect(sharedMap.dest_id).toBe(existingUrlRef.id);

			const allUrlRows = await dest('url_refs').select('url');
			expect(allUrlRows.map((r) => r.url).toSorted()).toEqual([
				'https://example.com/only-in-source',
				'https://example.com/shared',
			]);

			const newMap = await dest('xfer_map_url_refs')
				.where('src_id', newUrlRef.id)
				.first();
			expect(newMap).toBeDefined();
			const newDestRow = await dest('url_refs').where('id', newMap.dest_id).first();
			expect(newDestRow.url).toBe('https://example.com/only-in-source');
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('maps a composite-key dictionary (text_refs) correctly', async () => {
		const dest = await buildFullSchemaTestDb(destFile);
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const hash = Buffer.from('deadbeef', 'hex');
		const [textRef] = await source('text_refs')
			.insert({ hash, text: 'Hello' })
			.returning('id');
		await source.destroy();

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await copyDictionariesForConcat(dest);
			const map = await dest('xfer_map_text_refs').where('src_id', textRef.id).first();
			const destRow = await dest('text_refs').where('id', map.dest_id).first();
			expect(destRow.text).toBe('Hello');
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
