import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createViewerReadModelTables } from './create-viewer-read-model-tables.js';
import { upsertExternalLinkRows } from './upsert-external-link-rows.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

describe('upsertExternalLinkRows', () => {
	const workingDir = path.resolve(
		__dirname,
		'__test_fixtures_upsert_external_link_rows__',
	);
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'upsert-external-link-rows-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.getKnex().transaction((trx) => createViewerReadModelTables(trx));
		await archive
			.getKnex()('viewer_url_refs')
			.insert([
				{ id: 1, url: 'https://ads.example.com' },
				{ id: 2, url: 'https://tracking.example.com' },
			]);
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('inserts a new row as-is when no row exists yet for that dest_page_id', async () => {
		const knex = archive.getKnex();
		await knex.transaction((trx) =>
			upsertExternalLinkRows(trx, [
				{
					dest_page_id: 1,
					dest_url_ref_id: 1,
					status: 200,
					referrer_count: 2,
				},
			]),
		);
		const rows = await knex('viewer_external_links').select('*');
		expect(rows).toEqual([
			{
				dest_page_id: 1,
				dest_url_ref_id: 1,
				status: 200,
				referrer_count: 2,
			},
		]);
	});

	it('adds referrer_count into an existing row instead of overwriting it, simulating a second computeAnchorFactRows chunk observing the same destination', async () => {
		const knex = archive.getKnex();
		await knex.transaction((trx) =>
			upsertExternalLinkRows(trx, [
				{
					dest_page_id: 2,
					dest_url_ref_id: 2,
					status: 200,
					referrer_count: 3,
				},
			]),
		);
		await knex.transaction((trx) =>
			upsertExternalLinkRows(trx, [
				{
					dest_page_id: 2,
					dest_url_ref_id: 2,
					status: 200,
					referrer_count: 4,
				},
			]),
		);
		const row = await knex('viewer_external_links').where('dest_page_id', 2).first();
		expect(row).toMatchObject({ referrer_count: 7 });
	});

	it('splits a chunk larger than the internal insert-chunk size across multiple INSERT statements without dropping rows', async () => {
		const knex = archive.getKnex();
		const rows = Array.from({ length: 1200 }, (_, index) => ({
			dest_page_id: 1000 + index,
			dest_url_ref_id: 1000 + index,
			status: 200,
			referrer_count: 1,
		}));
		const refRows = rows.map((row) => ({
			id: row.dest_url_ref_id,
			url: `https://ads.example.com/${row.dest_url_ref_id}`,
		}));
		for (let start = 0; start < refRows.length; start += 500) {
			await knex('viewer_url_refs').insert(refRows.slice(start, start + 500));
		}
		await knex.transaction((trx) => upsertExternalLinkRows(trx, rows));
		const count = await knex('viewer_external_links')
			.where('dest_page_id', '>=', 1000)
			.count('* as c');
		expect(Number(count[0]!.c)).toBe(1200);
	});
});
