import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasDedupeCapEventIdColumn } from './has-dedupe-cap-event-id-column.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_has_dedupe_cap_event_id_column__',
);

describe('hasDedupeCapEventIdColumn', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'has-dedupe-cap-column-test.nitpicker',
	);

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('reports true on a fresh archive (column present from create-entity-tables DDL)', async () => {
		const knex = archive.getKnex();
		expect(await hasDedupeCapEventIdColumn(knex)).toBe(true);
	});

	it('reports false once the column is dropped (simulates a pre-feature archive)', async () => {
		const knex = archive.getKnex();
		await knex.schema.alterTable('content_items', (t) => {
			t.dropColumn('dedupe_cap_event_id');
		});

		expect(await hasDedupeCapEventIdColumn(knex)).toBe(false);

		// Restore the column so afterAll's close()/other tests are unaffected.
		await knex.schema.alterTable('content_items', (t) => {
			t.integer('dedupe_cap_event_id');
		});
	});
});
