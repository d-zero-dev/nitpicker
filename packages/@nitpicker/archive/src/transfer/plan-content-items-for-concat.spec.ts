import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { planContentItemsForConcat } from './plan-content-items-for-concat.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'plan-concat-source.sqlite');
const destFile = path.resolve(workingDir, 'plan-concat-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('planContentItemsForConcat', () => {
	it('assigns full/replace/skip by comparing rank against the current destination', async () => {
		// Destination already holds:
		//  - /internal (scraped, internal) — a source with only a HEAD-only
		//    observation for this URL must be skipped.
		//  - /external (scraped, external HEAD-only) — a source with a full
		//    scrape for this URL must replace it.
		const dest = await buildFullSchemaTestDb(destFile);
		await seedContentItem(dest, 'https://example.com/internal', {
			scraped: 1,
			isExternal: 0,
		});
		await seedContentItem(dest, 'https://example.com/external', {
			scraped: 1,
			isExternal: 1,
		});

		const source = await buildFullSchemaTestDb(sourceFile, null);
		await seedContentItem(source, 'https://example.com/internal', {
			scraped: 1,
			isExternal: 1, // worse than dest's internal scrape -> skip
		});
		await seedContentItem(source, 'https://example.com/external', {
			scraped: 1,
			isExternal: 0, // better than dest's external HEAD -> replace
		});
		await seedContentItem(source, 'https://example.com/new-page', {
			scraped: 1,
			isExternal: 0, // no dest row yet -> full
		});
		await source.destroy();

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await planContentItemsForConcat(dest);
			const rows = await dest
				.select('xfer_ci_plan.action', 'url_refs.url')
				.from('xfer_ci_plan')
				.join(
					'xfer_src.content_items',
					'xfer_src.content_items.id',
					'xfer_ci_plan.src_id',
				)
				.join(
					'xfer_src.url_refs',
					'xfer_src.url_refs.id',
					'xfer_src.content_items.url_id',
				)
				.orderBy('url_refs.url');
			expect(rows).toEqual([
				{ url: 'https://example.com/external', action: TRANSFER_ACTION.replace },
				{ url: 'https://example.com/internal', action: TRANSFER_ACTION.skip },
				{ url: 'https://example.com/new-page', action: TRANSFER_ACTION.full },
			]);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('a tie (equal rank) replaces — later argument wins', async () => {
		const dest = await buildFullSchemaTestDb(destFile);
		await seedContentItem(dest, 'https://example.com/tied', {
			scraped: 1,
			isExternal: 0,
		});

		const source = await buildFullSchemaTestDb(sourceFile, null);
		await seedContentItem(source, 'https://example.com/tied', {
			scraped: 1,
			isExternal: 0,
		});
		await source.destroy();

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await planContentItemsForConcat(dest);
			const [row] = await dest.select('action').from('xfer_ci_plan');
			expect(row.action).toBe(TRANSFER_ACTION.replace);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
