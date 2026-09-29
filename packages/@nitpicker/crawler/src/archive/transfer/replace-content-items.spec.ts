import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { replaceContentItems } from './replace-content-items.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'replace-content-items-source.sqlite');
const destFile = path.resolve(workingDir, 'replace-content-items-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('replaceContentItems', () => {
	it('overwrites the destination row with the source observation, keeping url_id and clearing redirect/alias/dedupe columns', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const winner = await seedContentItem(source, 'https://example.com/page/', {
			scraped: 1,
			isExternal: 0,
			isTarget: 1,
		});
		await source('content_items')
			.where('id', winner)
			.update({ status: 200, crawl_order: 3 });
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const loser = await seedContentItem(dest, 'https://example.com/page/', {
			scraped: 1,
			isExternal: 1,
		});
		await dest('content_items').where('id', loser).update({ status: -1 });
		const loserRow = await dest('content_items').where('id', loser).first();
		const originalUrlId = loserRow.url_id;

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert({
				src_id: winner,
				action: TRANSFER_ACTION.replace,
				dest_id: loser,
			});

			await replaceContentItems(dest, { crawlOrderOffset: 10 });

			const row = await dest('content_items').where('id', loser).first();
			expect(row.url_id).toBe(originalUrlId);
			expect(row.is_external).toBe(0);
			expect(row.status).toBe(200);
			expect(row.crawl_order).toBe(13);
			expect(row.redirect_dest_id).toBeNull();
			expect(row.alias_of_id).toBeNull();
			expect(row.dedupe_cap_event_id).toBeNull();
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
