import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { requireViewerReadModel } from './require-viewer-read-model.js';
import { createViewerReadModelTables } from './viewer-read-model/create-viewer-read-model-tables.js';
import { VIEWER_READ_MODEL_SCHEMA_VERSION } from './viewer-read-model/viewer-read-model-schema-version.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_require_viewer_read_model__');

describe('requireViewerReadModel', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'require-viewer-read-model-test.nitpicker',
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

	it('throws an actionable error when the read model has not been built', async () => {
		await expect(requireViewerReadModel(archive)).rejects.toThrow(/viewer-build/);
	});

	it('resolves once the read model is at the current schema version', async () => {
		const knex = archive.getKnex();
		await knex.transaction(async (trx) => {
			await createViewerReadModelTables(trx);
			await trx('viewer_read_model_meta').insert({
				id: 1,
				schema_version: VIEWER_READ_MODEL_SCHEMA_VERSION,
				built_at: 1,
				source_row_count: 0,
			});
		});
		await expect(requireViewerReadModel(archive)).resolves.toBeUndefined();
	});
});
