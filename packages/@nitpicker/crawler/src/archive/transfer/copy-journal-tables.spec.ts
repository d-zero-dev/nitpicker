import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyJournalTables } from './copy-journal-tables.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-journal-tables-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-journal-tables-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyJournalTables', () => {
	it('concat mode copies every crawl_errors row unconditionally', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		await source('crawl_errors').insert([
			{
				url: 'https://example.com/gone/',
				isExternal: false,
				message: 'DNS',
				createdAt: 1,
			},
			{ url: null, isExternal: false, message: 'process error', createdAt: 2 },
		]);
		await source('network_outages').insert({
			started_at: 1,
			detected_at: 2,
			trigger_error_count: 3,
			trigger_host_count: 1,
		});
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await copyJournalTables(dest, 'concat');
			const errors = await dest('crawl_errors').select('message');
			expect(errors.map((e) => e.message).toSorted()).toEqual(['DNS', 'process error']);
			const outages = await dest('network_outages').select('trigger_error_count');
			expect(outages).toHaveLength(1);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('split mode drops crawl_errors whose url no longer exists in the destination', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		await source('crawl_errors').insert([
			{
				url: 'https://example.com/kept/',
				isExternal: false,
				message: 'kept',
				createdAt: 1,
			},
			{
				url: 'https://example.com/dropped/',
				isExternal: false,
				message: 'dropped',
				createdAt: 2,
			},
		]);
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		await dest('url_refs').insert({ url: 'https://example.com/kept/' });

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await copyJournalTables(dest, 'split');
			const errors = await dest('crawl_errors').select('message');
			expect(errors).toEqual([{ message: 'kept' }]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
