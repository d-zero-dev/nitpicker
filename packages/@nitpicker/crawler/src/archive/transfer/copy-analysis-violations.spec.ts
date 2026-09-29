import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildFullSchemaTestDb } from '../test-utils/build-full-schema-test-db.js';
import { seedContentItem } from '../test-utils/seed-content-item.js';

import { attachSourceDatabase } from './attach-source-database.js';
import { copyAnalysisViolations } from './copy-analysis-violations.js';
import { createTransferTempTables } from './create-transfer-temp-tables.js';
import { dropTransferTempTables } from './drop-transfer-temp-tables.js';
import { TRANSFER_ACTION } from './transfer-action.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

const sourceFile = path.resolve(workingDir, 'copy-analysis-violations-source.sqlite');
const destFile = path.resolve(workingDir, 'copy-analysis-violations-dest.sqlite');

afterEach(async () => {
	await fs.rm(sourceFile, { force: true });
	await fs.rm(destFile, { force: true });
});

describe('copyAnalysisViolations', () => {
	it('remaps message/code text ids and copies plain columns verbatim', async () => {
		const source = await buildFullSchemaTestDb(sourceFile, null);
		const page = await seedContentItem(source, 'https://example.com/');
		const [message] = await source('analysis_text_refs')
			.insert({ text: 'Missing alt', sha256: 'a'.repeat(64) })
			.returning('id');
		await source('analysis_violations').insert({
			page_id: page,
			validator: 'html',
			severity: 'error',
			rule: 'img-alt',
			message_text_id: message.id,
			page_url_sort_key: 'a',
			message_sort_key: 'b',
			code_sort_key: 'c',
			line: 10,
			col: 2,
		});
		await source.destroy();

		const dest = await buildFullSchemaTestDb(destFile, null);
		const destPage = await seedContentItem(dest, 'https://example.com/');
		const [destMessage] = await dest('analysis_text_refs')
			.insert({ text: 'Missing alt', sha256: 'a'.repeat(64) })
			.returning('id');

		const detach = await attachSourceDatabase(dest, sourceFile);
		await createTransferTempTables(dest);
		try {
			await dest('xfer_map_analysis_text_refs').insert({
				src_id: message.id,
				dest_id: destMessage.id,
			});
			await dest('xfer_ci_plan').insert({
				src_id: page,
				action: TRANSFER_ACTION.full,
				dest_id: destPage,
			});

			await copyAnalysisViolations(dest);

			const row = await dest('analysis_violations').first();
			expect(row.page_id).toBe(destPage);
			expect(row.message_text_id).toBe(destMessage.id);
			expect(row.code_text_id).toBeNull();
			expect(row.rule).toBe('img-alt');
			expect(row.line).toBe(10);
		} finally {
			await dropTransferTempTables(dest);
			await detach();
		}
		await dest.destroy();
	});
});
