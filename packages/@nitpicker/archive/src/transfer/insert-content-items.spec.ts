import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { insertContentItems } from './insert-content-items.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'insert-content-items-source.sqlite');
const destFile = path.resolve(workingDir, 'insert-content-items-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('insertContentItems', () => {
	it('inserts full rows as-is, forces stub rows external, applies the crawl_order offset, and backfills dest_id', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const fullPage = await seedContentItem(source, 'https://example.com/full/', {
			scraped: 1,
			isExternal: 0,
			isTarget: 1,
		});
		await source('content_items').where('id', fullPage).update({ crawl_order: 5 });
		const stubPage = await seedContentItem(source, 'https://example.com/stub/', {
			scraped: 1,
			isExternal: 0, // was internal in source; must be forced external as a stub
			isTarget: 1,
		});
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		// Pre-seed the destination dictionaries + maps by hand (isolated from
		// the dictionary-copy functions, which have their own specs).
		const [fullUrl] = await dest('url_refs')
			.insert({ url: 'https://example.com/full/' })
			.returning('id');
		const [stubUrl] = await dest('url_refs')
			.insert({ url: 'https://example.com/stub/' })
			.returning('id');

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_map_url_refs').insert([
				{ src_id: fullPage, dest_id: fullUrl.id },
				{ src_id: stubPage, dest_id: stubUrl.id },
			]);
			await dest('xfer_ci_plan').insert([
				{ src_id: fullPage, action: TRANSFER_ACTION.full },
				{ src_id: stubPage, action: TRANSFER_ACTION.stub },
			]);

			await insertContentItems(dest, { crawlOrderOffset: 100 });

			const rows = await dest
				.select(
					'content_items.is_external',
					'content_items.is_target',
					'content_items.crawl_order',
					'url_refs.url',
				)
				.from('content_items')
				.join('url_refs', 'url_refs.id', 'content_items.url_id')
				.orderBy('url_refs.url');
			expect(rows).toEqual([
				{
					url: 'https://example.com/full/',
					is_external: 0,
					is_target: 1,
					crawl_order: 105,
				},
				{
					url: 'https://example.com/stub/',
					is_external: 1,
					is_target: 0,
					crawl_order: null,
				},
			]);

			const plan = await dest
				.select('src_id', 'dest_id')
				.from('xfer_ci_plan')
				.orderBy('src_id');
			for (const row of plan) {
				expect(row.dest_id).not.toBeNull();
			}
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
