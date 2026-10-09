import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { remapRedirectDestIds } from './remap-redirect-dest-ids.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'remap-redirect-source.sqlite');
const destFile = path.resolve(workingDir, 'remap-redirect-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('remapRedirectDestIds', () => {
	it('remaps a full row redirect target into destination id space', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const srcFrom = await seedContentItem(source, 'https://example.com/from/');
		const srcTo = await seedContentItem(source, 'https://example.com/to/');
		await source('content_items')
			.where('id', srcFrom)
			.update({ redirect_dest_id: srcTo });
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destFrom = await seedContentItem(dest, 'https://example.com/from/');
		const destTo = await seedContentItem(dest, 'https://example.com/to/');

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert([
				{ src_id: srcFrom, action: TRANSFER_ACTION.full, dest_id: destFrom },
				{ src_id: srcTo, action: TRANSFER_ACTION.full, dest_id: destTo },
			]);

			await remapRedirectDestIds(dest);

			const row = await dest('content_items').where('id', destFrom).first();
			expect(row.redirect_dest_id).toBe(destTo);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('never touches a skip-action row', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const srcFrom = await seedContentItem(source, 'https://example.com/from/');
		const srcTo = await seedContentItem(source, 'https://example.com/to/');
		await source('content_items')
			.where('id', srcFrom)
			.update({ redirect_dest_id: srcTo });
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destFrom = await seedContentItem(dest, 'https://example.com/from/');
		await dest('content_items').where('id', destFrom).update({ redirect_dest_id: null });
		const destTo = await seedContentItem(dest, 'https://example.com/to/');

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert([
				{ src_id: srcFrom, action: TRANSFER_ACTION.skip, dest_id: destFrom },
				{ src_id: srcTo, action: TRANSFER_ACTION.skip, dest_id: destTo },
			]);

			await remapRedirectDestIds(dest);

			const row = await dest('content_items').where('id', destFrom).first();
			expect(row.redirect_dest_id).toBeNull();
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
