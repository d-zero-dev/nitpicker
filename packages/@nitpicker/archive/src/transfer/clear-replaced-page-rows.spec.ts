import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { createLegacyAnalysisTables } from '../test-utils/create-legacy-analysis-tables.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { clearReplacedPageRows } from './clear-replaced-page-rows.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'clear-replaced-source.sqlite');
const destFile = path.resolve(workingDir, 'clear-replaced-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('clearReplacedPageRows', () => {
	it('deletes derived rows only for replace-action dest ids, leaving other pages untouched', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		// Current schema: no legacy table, so the guarded delete must be skipped.
		expect(await dest.schema.hasTable('analysis_violations')).toBe(false);
		const replacedPage = await seedContentItem(dest, 'https://example.com/replaced/');
		const untouchedPage = await seedContentItem(dest, 'https://example.com/untouched/');
		await dest('page_meta').insert([
			{ page_id: replacedPage, lang: 'ja' },
			{ page_id: untouchedPage, lang: 'ja' },
		]);
		await dest('page_errors').insert({
			pageId: replacedPage,
			phase: 'scrape',
			message: 'boom',
			createdAt: 0,
		});

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert({
				src_id: 999,
				action: TRANSFER_ACTION.replace,
				dest_id: replacedPage,
			});

			await clearReplacedPageRows(dest);

			const replacedMeta = await dest('page_meta').where('page_id', replacedPage);
			expect(replacedMeta).toHaveLength(0);
			const replacedErrors = await dest('page_errors').where('pageId', replacedPage);
			expect(replacedErrors).toHaveLength(0);
			const untouchedMeta = await dest('page_meta').where('page_id', untouchedPage);
			expect(untouchedMeta).toHaveLength(1);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});

	it('also clears legacy analysis_violations rows when the destination archive still has the table', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		await createLegacyAnalysisTables(dest);
		const replacedPage = await seedContentItem(dest, 'https://example.com/replaced/');
		const untouchedPage = await seedContentItem(dest, 'https://example.com/untouched/');
		await dest('analysis_text_refs').insert({ id: 1, text: 'msg', sha256: 'abc' });
		for (const pageId of [replacedPage, untouchedPage]) {
			await dest('analysis_violations').insert({
				page_id: pageId,
				validator: 'axe',
				severity: 'error',
				rule: 'label',
				message_text_id: 1,
				page_url_sort_key: `page-${pageId}`,
				message_sort_key: 'msg',
				code_sort_key: '',
			});
		}

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_ci_plan').insert({
				src_id: 999,
				action: TRANSFER_ACTION.replace,
				dest_id: replacedPage,
			});

			await clearReplacedPageRows(dest);

			expect(
				await dest('analysis_violations').where('page_id', replacedPage),
			).toHaveLength(0);
			expect(
				await dest('analysis_violations').where('page_id', untouchedPage),
			).toHaveLength(1);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
