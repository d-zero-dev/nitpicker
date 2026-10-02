import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copySimplePageScopedTables } from './copy-simple-page-scoped-tables.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-simple-page-scoped-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-simple-page-scoped-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copySimplePageScopedTables', () => {
	it('copies rows verbatim (remapped only to the dest page id) for full pages, skips stub pages', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const fullPage = await seedContentItem(source, 'https://example.com/full/');
		const stubPage = await seedContentItem(source, 'https://example.com/stub/');
		await source('page_jsonld').insert([
			{ pageId: fullPage, kind: 'json-ld', type: 'Article', raw: '{}' },
			{ pageId: stubPage, kind: 'json-ld', type: 'Article', raw: '{}' },
		]);
		await source('page_errors').insert({
			pageId: fullPage,
			phase: 'scrape',
			message: 'timeout',
			createdAt: 123,
		});
		await source('page_technologies').insert({
			pageId: fullPage,
			technology: 'WordPress',
			confidence: 90,
			signalCount: 2,
		});
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destFullPage = await seedContentItem(dest, 'https://example.com/full/');
		const destStubPage = await seedContentItem(dest, 'https://example.com/stub/', {
			isExternal: 1,
			isTarget: 0,
		});

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert([
				{ src_id: fullPage, action: TRANSFER_ACTION.full, dest_id: destFullPage },
				{ src_id: stubPage, action: TRANSFER_ACTION.stub, dest_id: destStubPage },
			]);

			await copySimplePageScopedTables(dest);

			const jsonld = await dest('page_jsonld').select('pageId', 'type');
			expect(jsonld).toEqual([{ pageId: destFullPage, type: 'Article' }]);
			const errors = await dest('page_errors').select('pageId', 'message');
			expect(errors).toEqual([{ pageId: destFullPage, message: 'timeout' }]);
			const tech = await dest('page_technologies').select('pageId', 'technology');
			expect(tech).toEqual([{ pageId: destFullPage, technology: 'WordPress' }]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('copies page_html_ref (hash passes through unchanged) for full pages so the HTML snapshot stays readable in the output', async () => {
		const blob = {
			hash: Buffer.from('a'.repeat(32)),
			body: Buffer.from('<html></html>'),
			codec: 'none',
			size_raw: 13,
			size_stored: 13,
		};
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const fullPage = await seedContentItem(source, 'https://example.com/full/');
		await source('page_html_blobs').insert(blob);
		await source('page_html_ref').insert({ page_id: fullPage, hash: blob.hash });
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destFullPage = await seedContentItem(dest, 'https://example.com/full/');
		// `copy-page-html-blobs.ts` runs before this step in the real pipeline.
		await dest('page_html_blobs').insert(blob);

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert({
				src_id: fullPage,
				action: TRANSFER_ACTION.full,
				dest_id: destFullPage,
			});

			await copySimplePageScopedTables(dest);

			const refs = await dest('page_html_ref').select('page_id', 'hash');
			expect(
				refs.map((r) => ({
					pageId: r.page_id,
					hash: Buffer.from(r.hash).toString('hex'),
				})),
			).toEqual([{ pageId: destFullPage, hash: '61'.repeat(32) }]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
