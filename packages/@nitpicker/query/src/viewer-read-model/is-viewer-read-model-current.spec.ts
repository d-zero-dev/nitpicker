import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createViewerReadModelTables } from './create-viewer-read-model-tables.js';
import { isViewerReadModelCurrent } from './is-viewer-read-model-current.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model-schema-version.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_is_viewer_read_model_current__',
);

describe('isViewerReadModelCurrent', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'is-current-test.nitpicker');

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

	it('returns false when the read model has not been built', async () => {
		expect(await isViewerReadModelCurrent(archive)).toBe(false);
	});

	it('returns false when the read model exists but is at a stale schema version', async () => {
		const knex = archive.getKnex();
		await knex.transaction(async (trx) => {
			await createViewerReadModelTables(trx);
			await trx('viewer_read_model_meta').insert({
				id: 1,
				schema_version: VIEWER_READ_MODEL_SCHEMA_VERSION - 1,
				built_at: 1,
				source_row_count: 0,
			});
		});
		expect(await isViewerReadModelCurrent(archive)).toBe(false);
	});

	it('returns true once the read model is at the current schema version', async () => {
		const knex = archive.getKnex();
		await knex('viewer_read_model_meta')
			.where('id', 1)
			.update({ schema_version: VIEWER_READ_MODEL_SCHEMA_VERSION });
		expect(await isViewerReadModelCurrent(archive)).toBe(true);
	});
});
