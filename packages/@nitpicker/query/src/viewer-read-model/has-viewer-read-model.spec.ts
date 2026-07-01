import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createViewerReadModelTables } from './create-viewer-read-model-tables.js';
import { hasViewerReadModel } from './has-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_has_viewer_read_model__');

describe('hasViewerReadModel', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'has-read-model-test.nitpicker');

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
		expect(await hasViewerReadModel(archive)).toBe(false);
	});

	it('returns true once the tables and meta row exist', async () => {
		const knex = archive.getKnex();
		await knex.transaction(async (trx) => {
			await createViewerReadModelTables(trx);
			await trx('viewer_read_model_meta').insert({
				id: 1,
				schema_version: 1,
				built_at: 1,
				source_row_count: 0,
			});
		});
		expect(await hasViewerReadModel(archive)).toBe(true);
	});
});
